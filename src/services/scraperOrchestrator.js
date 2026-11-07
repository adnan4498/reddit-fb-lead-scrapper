const Job = require("../models/Job");
const mongoose = require("mongoose");
const { exec } = require("child_process");
const {
  updateScrapeProgress,
  resetScrapeProgress,
} = require("./scrapeProgress");
const rssFeedParser = require("./scrapers/rssFeedParser");
const apiIngestor = require("./scrapers/apiIngestor");
const { fetchJobs: fetchAggregatorJobs } = require("./scrapers/aggregatorApi");
const atsIngestor = require("./scrapers/atsIngestor");
const cheerioScraper = require("./scrapers/cheerioScraper");
const playwrightScraper = require("./scrapers/playwrightScraper");
const protectedScraper = require("./scrapers/protectedScraper");
const { resolveFuzzyDuplicates } = require("./dedup/llmResolver");
const { scoreJob } = require("./scorer");
const {
  startBatchSession,
  logBatchEntry,
  finishBatchSession,
} = require("../../scripts/lib/logger");
const { shouldExcludeCompany } = require("../../scripts/lib/company-filter");
const { getSourceRank } = require("../utils/sourceRank");
const { TITLE_BLACKLIST_REGEX } = require("../config/platforms");

const LIGHTWEIGHT_SCRAPERS = [
  { name: "RSS Feed Parser", module: rssFeedParser },
  { name: "API Ingestor", module: apiIngestor },
  { name: "ATS Ingestor", module: atsIngestor },
];

const HEAVYWEIGHT_SCRAPERS = [
  { name: "Cheerio Scraper", module: cheerioScraper },
  { name: "Protected Scraper", module: protectedScraper },
  { name: "Playwright Scraper", module: playwrightScraper },
];

const AUTO_DROP_THRESHOLD = 0.96;
const CLUSTER_FLOOR = 0.72;

function getChar(s, i) {
  return s.charAt(i);
}

function jaroWinkler(s1, s2) {
  const a1 = s1.toLowerCase().trim();
  const a2 = s2.toLowerCase().trim();

  if (a1 === a2) return 1.0;
  if (!a1.length || !a2.length) return 0.0;

  const matchWindow = Math.floor(Math.max(a1.length, a2.length) / 2) - 1;

  const a1Matches = new Array(a1.length).fill(false);
  const a2Matches = new Array(a2.length).fill(false);

  let matches = 0;

  for (let i = 0; i < a1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, a2.length);
    for (let j = start; j < end; j++) {
      if (!a2Matches[j] && getChar(a1, i) === getChar(a2, j)) {
        a1Matches[i] = true;
        a2Matches[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a1.length; i++) {
    if (!a1Matches[i]) continue;
    while (k < a2.length && !a2Matches[k]) k++;
    if (k < a2.length && getChar(a1, i) !== getChar(a2, k)) transpositions++;
    k++;
  }
  transpositions = Math.floor(transpositions / 2);

  const jaro =
    (matches / a1.length +
      matches / a2.length +
      (matches - transpositions) / matches) /
    3;

  let prefix = 0;
  const maxPrefix = 4;
  for (let i = 0; i < Math.min(a1.length, a2.length, maxPrefix); i++) {
    if (getChar(a1, i) === getChar(a2, i)) {
      prefix++;
    } else {
      break;
    }
  }

  const scalingFactor = 0.1;
  return jaro + prefix * scalingFactor * (1 - jaro);
}

function levenshteinDistance(a, b) {
  const aLen = a.length;
  const bLen = b.length;
  const matrix = [];

  for (let i = 0; i <= bLen; i++) matrix[i] = [i];
  for (let j = 0; j <= aLen; j++) matrix[0][j] = j;

  for (let i = 1; i <= bLen; i++) {
    for (let j = 1; j <= aLen; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }

  return matrix[bLen][aLen];
}

function levenshteinSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function wordTokenOverlap(a, b) {
  const tokenize = (s) => {
    const words = s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return new Set(words);
  };
  const setA = tokenize(a);
  const setB = tokenize(b);
  for (const word of setA) {
    if (setB.has(word)) return true;
  }
  return false;
}

function jaccardTokens(a, b) {
  const tokenize = (s) => {
    const words = s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return new Set(words);
  };
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  return intersection / (setA.size + setB.size - intersection);
}

const similarityCache = new Map();

function cachedTitleSimilarity(t1, t2) {
  const key = t1 < t2 ? t1 + "|||" + t2 : t2 + "|||" + t1;
  if (similarityCache.has(key)) return similarityCache.get(key);
  const sim = titleSimilarity(t1, t2);
  similarityCache.set(key, sim);
  return sim;
}

function normalizedCompany(name) {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[,.;:'"()\[\]{}!?@#$%^&*+=|\\/~`\s-]+/g, "")
    .replace(/inc$|llc$|ltd$|corp$|corporation$|limited$|gmbh$|co$/g, "")
    .trim();
}

function titleSimilarity(t1, t2) {
  if (!wordTokenOverlap(t1, t2)) return 0.0;

  const jw = jaroWinkler(t1, t2);
  const ls = levenshteinSimilarity(t1, t2);
  return Math.max(jw, ls);
}

async function isDuplicate(job, companyHistoryMap) {
  const slugMatch = await Job.findOne({ slug: job.slug });
  if (slugMatch) return true;

  const companyKey = job.company.toLowerCase().trim();
  const recentJobs = companyHistoryMap.get(companyKey) || [];

  for (const existing of recentJobs) {
    const sim = titleSimilarity(job.title, existing.title);
    if (sim >= AUTO_DROP_THRESHOLD) {
      const existingRank = getSourceRank(existing.url);
      const newRank = getSourceRank(job.url);
      if (newRank < existingRank) {
        return { isDuplicate: false, replaceExisting: true, existing };
      }
      return true;
    }
  }

  return false;
}

function groupByCompany(jobs) {
  const map = new Map();
  for (const job of jobs) {
    const key = job.company.toLowerCase().trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(job);
  }
  return Array.from(map.values());
}

function buildClusters(companyGroup) {
  if (companyGroup.length < 2) return [];

  const n = companyGroup.length;
  const adj = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (jaccardTokens(companyGroup[i].title, companyGroup[j].title) < 0.6)
        continue;
      const sim = cachedTitleSimilarity(
        companyGroup[i].title,
        companyGroup[j].title,
      );
      if (sim >= CLUSTER_FLOOR && sim < AUTO_DROP_THRESHOLD) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const visited = new Set();
  const clusters = [];

  for (let i = 0; i < n; i++) {
    if (visited.has(i)) continue;

    const component = [];
    const stack = [i];
    visited.add(i);

    while (stack.length > 0) {
      const node = stack.pop();
      component.push(companyGroup[node]);
      for (const neighbor of adj[node]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }

    if (component.length >= 2) {
      clusters.push(component);
    }
  }

  return clusters;
}

async function applyDuplicateStatuses(duplicateIds) {
  if (!duplicateIds || duplicateIds.length === 0) return 0;

  try {
    const result = await Job.updateMany(
      { _id: { $in: duplicateIds } },
      { $set: { status: "Duplicate" } },
    );
    console.log(
      `[ORCH] Marked ${result.modifiedCount} jobs as Duplicate via LLM`,
    );
    return result.modifiedCount;
  } catch (err) {
    console.error(`[ORCH] Failed to mark duplicates: ${err.message}`);
    return 0;
  }
}

async function runAllScrapers() {
  console.log("[ORCH] ===== Scraping run started =====");

  resetScrapeProgress();
  updateScrapeProgress({
    status: "running",
    startedAt: new Date().toISOString(),
  });

  if (mongoose.connection.readyState !== 1) {
    console.error(
      "[ORCH] MongoDB is not connected (state: %d). Aborting scrape run.",
      mongoose.connection.readyState,
    );
    return {
      inserted: 0,
      duplicates: 0,
      excluded: 0,
      invalid: 0,
      llmDuplicates: 0,
      errors: 1,
      total: 0,
      dbConnected: false,
    };
  }

  console.log(
    "[ORCH] DB state: connected (readyState=1), DB name: %s",
    mongoose.connection.db.databaseName,
  );

  startBatchSession("Full platform scraping run");

  // ── PREMIUM FIRST ──
  // Launch the browser panel before running aggregators so the panel starts
  // opening premium-site tabs immediately. The panel is fire-and-forget:
  // it POSTs its own results to /api/{platform}/upload-json independently
  // of this function. Aggregators run below in the background and write
  // their own results when they finish.
  try {
    console.log(
      "[ORCH] Launching browser scraper panel (premium sites) first...",
    );
    exec(
      "start http://localhost:3000/indeed-scraper.html?autostart=true",
      (err) => {
        if (err) console.error("[ORCH] Browser launch failed:", err.message);
      },
    );
  } catch (launchErr) {
    console.error("[ORCH] Browser launch error:", launchErr.message);
  }

  let allJobs = [];

  if (false) {
    for (const scraper of LIGHTWEIGHT_SCRAPERS) {
      try {
        const jobs = await scraper.module.fetchJobs();
        console.log(`[ORCH] ${scraper.name}: ${jobs.length} jobs`);
        allJobs.push(...jobs);
        logBatchEntry(scraper.name, "all", "all", jobs.length, true);
      } catch (err) {
        console.error(`[ORCH] Scraper "${scraper.name}" failed:`, err.message);
        logBatchEntry(scraper.name, "error", "all", 0, true);
      }
    }
  }

  // ── AGGREGATOR KILL SWITCH ──
  // Set AGGREGATORS_ENABLED=false in .env to disable all 20+ aggregators
  // without touching this file or aggregatorApi.js.
  const AGGREGATORS_ENABLED = process.env.AGGREGATORS_ENABLED !== "false";

  if (!AGGREGATORS_ENABLED) {
    console.log(
      "[ORCH] Aggregators disabled via AGGREGATORS_ENABLED=false — skipping.",
    );
  } else {
    try {
      const currentHour = new Date().getHours();
      if (currentHour >= 12) {
        console.log(
          `[ORCH] Evening run (hour=${currentHour}) — cost-saving: NoFluffJobs will self-skip via isAvailable`,
        );
      }
      const aggJobs = await fetchAggregatorJobs();
      console.log(`[ORCH] Aggregator API: ${aggJobs.length} jobs`);
      allJobs.push(...aggJobs);
      logBatchEntry("Aggregator API", "all", "all", aggJobs.length, true);
    } catch (err) {
      console.error(`[ORCH] Aggregator API failed:`, err.message);
      logBatchEntry("Aggregator API", "error", "all", 0, true);
    }
  }

  if (false) {
    console.log("[ORCH] Heavyweight scrapers starting...");

    for (const scraper of HEAVYWEIGHT_SCRAPERS) {
      try {
        const jobs = await scraper.module.fetchJobs();
        console.log(`[ORCH] ${scraper.name}: ${jobs.length} jobs`);
        allJobs.push(...jobs);
        logBatchEntry(scraper.name, "all", "all", jobs.length, true);
      } catch (err) {
        console.error(`[ORCH] Scraper "${scraper.name}" failed:`, err.message);
        logBatchEntry(scraper.name, "error", "all", 0, true);
      }
    }
  }

  console.log(`[ORCH] Total raw jobs collected: ${allJobs.length}`);

  // ── Rank-aware fingerprint dedup across all scrapers ──
  const rankSorted = allJobs.slice().sort((a, b) => {
    const ra = getSourceRank(a.url);
    const rb = getSourceRank(b.url);
    if (ra !== rb) return ra - rb;
    return (b.score || 0) - (a.score || 0);
  });
  const seenFingerprints = new Map();
  allJobs = [];
  for (const job of rankSorted) {
    const fp = `${(job.title || "").toLowerCase().trim()}_${(job.company || "").toLowerCase().trim()}`;
    const existingRank = seenFingerprints.get(fp);
    const newRank = getSourceRank(job.url);
    if (existingRank === undefined || newRank < existingRank) {
      seenFingerprints.set(fp, newRank);
      const dupIdx = allJobs.findIndex((j) => {
        const efp = `${(j.title || "").toLowerCase().trim()}_${(j.company || "").toLowerCase().trim()}`;
        return efp === fp;
      });
      if (dupIdx !== -1) {
        console.log(
          `[ORCH] Replacing Tier-${existingRank} fingerprint "${fp.substring(0, 60)}" with Tier-${newRank}`,
        );
        allJobs[dupIdx] = job;
      } else {
        allJobs.push(job);
      }
    }
  }
  console.log(
    `[ORCH] Rank-aware fingerprint dedup: ${rankSorted.length} → ${allJobs.length} jobs`,
  );

  // ── 48‑hour (2‑day) filter ──
  const originalCount = allJobs.length;
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48 hours
  allJobs = allJobs.filter((job) => {
    const jobDate = job.postedAt
      ? new Date(job.postedAt)
      : job.scrapedAt
        ? new Date(job.scrapedAt)
        : null;
    // If no date, keep it (fallback) – but we log a warning
    if (!jobDate) {
      console.warn(`[ORCH] Job missing date: ${job.title} @ ${job.company}`);
      return true;
    }
    return jobDate >= twoDaysAgo;
  });
  console.log(
    `[ORCH] After 48h filter: ${allJobs.length} jobs remain (removed ${originalCount - allJobs.length})`,
  );

  const allSlugs = allJobs.map((j) => j.slug).filter(Boolean);
  const existingSlugDocs = await Job.find(
    { slug: { $in: allSlugs } },
    { slug: 1, url: 1, _id: 0 },
  ).lean();
  const existingSlugRanks = new Map();
  for (const doc of existingSlugDocs) {
    existingSlugRanks.set(doc.slug, getSourceRank(doc.url));
  }
  console.log(
    `[ORCH] Slug pre-check: ${existingSlugRanks.size} of ${allSlugs.length} slugs already exist in DB`,
  );

  const uniqueCompanies = [
    ...new Set(
      allJobs.map((j) => j.company.toLowerCase().trim()).filter(Boolean),
    ),
  ];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const companyHistoryDocs = await Job.find({
    company: { $in: uniqueCompanies },
    scrapedAt: { $gte: sevenDaysAgo },
  })
    .select("title company")
    .lean();
  const companyHistoryMap = new Map();
  for (const doc of companyHistoryDocs) {
    const key = doc.company.toLowerCase().trim();
    if (!companyHistoryMap.has(key)) companyHistoryMap.set(key, []);
    companyHistoryMap.get(key).push(doc);
  }
  console.log(
    `[ORCH] Company history cache: ${companyHistoryDocs.length} docs across ${uniqueCompanies.length} unique companies`,
  );

  let inserted = 0;
  let duplicates = 0;
  let excluded = 0;
  let excludedTitle = 0;
  let errors = 0;
  let invalid = 0;
  let dupSkipped = 0;
  const candidateJobs = [];
  const bulkOps = [];

  for (const job of allJobs) {
    try {
      if (!job.url || !job.title || !job.company) {
        invalid++;
        continue;
      }

      if (shouldExcludeCompany(job.company)) {
        excluded++;
        continue;
      }

      job.title = job.title
        .replace(/\s*\((m|w|d|f|gn)(\/(m|w|d|f|gn))*\)/gi, "")
        .trim();
      if (TITLE_BLACKLIST_REGEX.test(job.title)) {
        excludedTitle++;
        continue;
      }

      const existingSlugRank = existingSlugRanks.get(job.slug);
      if (existingSlugRank !== undefined) {
        const newRank = getSourceRank(job.url);
        if (newRank >= existingSlugRank) {
          dupSkipped++;
          continue;
        }
        existingSlugRanks.delete(job.slug);
      }

      const dupCheck = await isDuplicate(job, companyHistoryMap);
      if (dupCheck === true) {
        duplicates++;
        continue;
      }

      if (dupCheck?.replaceExisting && dupCheck.existing) {
        existingSlugRanks.delete(dupCheck.existing.slug);
        const existingIdx = candidateJobs.findIndex(
          (j) => j.slug === dupCheck.existing.slug,
        );
        if (existingIdx !== -1) {
          candidateJobs.splice(existingIdx, 1);
          bulkOps.splice(existingIdx, 1);
          duplicates--;
        }
      }

      const scoring = scoreJob(job);
      job.score = scoring.score;
      job.matchedRules = scoring.matchedRules;

      const newRank = getSourceRank(job.url);
      if (existingSlugRank !== undefined) {
        bulkOps.push({
          updateOne: {
            filter: { slug: job.slug },
            update: { $set: job },
          },
        });
        console.log(
          `[ORCH] Replacing Tier-${existingSlugRank} slug "${job.slug.substring(0, 60)}" with Tier-${newRank}`,
        );
      } else {
        bulkOps.push({
          updateOne: {
            filter: { url: job.url },
            update: { $setOnInsert: job },
            upsert: true,
          },
        });
      }

      existingSlugRanks.set(job.slug, newRank);

      candidateJobs.push(job);
    } catch (err) {
      console.error(
        `[ORCH] Error pre-processing "${job.title}": ${err.message}`,
      );
      errors++;
    }
  }

  console.log(
    `[ORCH] Pre-filter complete: ${candidateJobs.length} candidates, ${invalid} invalid, ${excluded} excluded, ${excludedTitle} excluded-title, ${dupSkipped} slug-skipped, ${duplicates} dup-skipped`,
  );

  // ── Batch insert with detailed progress logging ──
  const BATCH_SIZE = 500;
  const totalBatches = Math.ceil(bulkOps.length / BATCH_SIZE);

  for (let i = 0; i < bulkOps.length; i += BATCH_SIZE) {
    const batchOps = bulkOps.slice(i, i + BATCH_SIZE);
    const batchCandidates = candidateJobs.slice(i, i + BATCH_SIZE);

    try {
      const bulkResult = await Job.bulkWrite(batchOps, { ordered: false });
      const insertedThisBatch = bulkResult.upsertedCount || 0;
      inserted += insertedThisBatch;
      duplicates += batchOps.length - insertedThisBatch;

      const processed = Math.min(i + BATCH_SIZE, bulkOps.length);
      const remaining = bulkOps.length - processed;
      updateScrapeProgress({
        total: bulkOps.length,
        processed: processed,
        inserted: inserted,
        duplicates: duplicates,
        excluded: excluded,
        status: "running",
      });

      // ── Detailed progress log ──
      console.log(
        `[ORCH] Progress: processed ${processed}/${bulkOps.length}, ` +
          `inserted ${inserted}, dupes ${duplicates}, remaining ${remaining}`,
      );
      console.log(
        `[ORCH] Batch ${Math.floor(i / BATCH_SIZE) + 1}/${totalBatches}: +${insertedThisBatch} inserted (total ${inserted})`,
      );

      if (bulkResult.upsertedIds) {
        for (let j = 0; j < bulkResult.upsertedIds.length; j++) {
          const key = Object.keys(bulkResult.upsertedIds[j])[0];
          batchCandidates[j]._id = bulkResult.upsertedIds[j][key];
        }
      }
    } catch (err) {
      if (err.name === "MongoBulkWriteError" && err.result) {
        const result = err.result;
        const insertedThisBatch = result.upsertedCount || result.nInserted || 0;
        inserted += insertedThisBatch;
        duplicates += batchOps.length - insertedThisBatch;
        const processed = Math.min(i + BATCH_SIZE, bulkOps.length);
        const remaining = bulkOps.length - processed;
        updateScrapeProgress({
          total: bulkOps.length,
          processed: processed,
          inserted: inserted,
          duplicates: duplicates,
          excluded: excluded,
          status: "running",
        });
        // ── Detailed progress log (partial) ──
        console.log(
          `[ORCH] Progress: processed ${processed}/${bulkOps.length}, ` +
            `inserted ${inserted}, dupes ${duplicates}, remaining ${remaining} (partial batch)`,
        );
        console.log(
          `[ORCH] Batch ${Math.floor(i / BATCH_SIZE) + 1}: partial (${insertedThisBatch} inserted)`,
        );
      } else {
        console.error(`[ORCH] Batch failed: ${err.message}`);
        errors += batchOps.length;
      }
    }
  }

  // Update final progress
  updateScrapeProgress({
    status: "complete",
    completedAt: new Date().toISOString(),
  });

  console.log(
    `[ORCH] Local dedup complete: ${inserted} inserted, ${duplicates} duplicates, ${excluded} excluded, ${excludedTitle} excluded-title, ${dupSkipped} slug-skipped, ${invalid} invalid, ${errors} errors`,
  );

  try {
    const dbTotal = await Job.countDocuments({});
    console.log(
      `[ORCH] MongoDB collection 'jobs' document count after upsert: ${dbTotal}`,
    );
  } catch (dbCheckErr) {
    console.error(`[ORCH] Failed to verify DB count: ${dbCheckErr.message}`);
  }

  let llmDuplicates = 0;

  if (candidateJobs.length >= 2) {
    const blocked = new Map();
    for (const job of candidateJobs) {
      const key = normalizedCompany(job.company);
      if (!blocked.has(key)) blocked.set(key, []);
      blocked.get(key).push(job);
    }

    const allClusters = [];

    for (const group of blocked.values()) {
      const clusters = buildClusters(group);
      allClusters.push(...clusters);
    }

    if (allClusters.length > 0) {
      console.log(
        `[ORCH] ${allClusters.length} suspect cluster(s) → invoking LLM deduplication layer...`,
      );
      try {
        const duplicateIds = await resolveFuzzyDuplicates(allClusters);
        llmDuplicates = await applyDuplicateStatuses(duplicateIds);
      } catch (err) {
        console.error(`[ORCH] LLM dedup pipeline failed: ${err.message}`);
      }
    }
  }

  similarityCache.clear();

  console.log(
    `[ORCH] Run complete: ${inserted} inserted, ${duplicates} duplicates, ${excluded} excluded, ${excludedTitle} excluded-title, ${dupSkipped} slug-skipped, ${invalid} invalid, ${llmDuplicates} LLM dedup, ${errors} errors`,
  );

  finishBatchSession();

  // try {
  //   console.log("[ORCH] Launching Indeed/Browser scraper loop...");
  //   exec("start http://localhost:3000/indeed-scraper.html?autostart=true", (err) => {
  //     if (err) console.error("[ORCH] Browser launch failed:", err.message);
  //   });
  // } catch (launchErr) {
  //   console.error("[ORCH] Browser launch error:", launchErr.message);
  // }

  return {
    inserted,
    duplicates,
    excluded,
    excludedTitle,
    dupSkipped,
    invalid,
    llmDuplicates,
    errors,
    total: allJobs.length,
  };
}

module.exports = {
  runAllScrapers,
  titleSimilarity,
  wordTokenOverlap,
  jaccardTokens,
  normalizedCompany,
  jaroWinkler,
  levenshteinSimilarity,
  levenshteinDistance,
  groupByCompany,
  buildClusters,
};
