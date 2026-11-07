const { aggregatorConfig } = require("../../config/platforms");
const { shouldExcludeCompany } = require("../../../scripts/lib/company-filter");
const { determineJobStatus } = require("../../utils/routing");
const { fetchAdzunaJobs } = require("./adzunaModule");
const { fetchJoobleJobs } = require("./joobleModule");
const { fetchCareerjetJobs } = require("./careerjetModule");
const { fetchReedJobs } = require("./reedModule");
const { fetchSerperGoogleJobs } = require("./serperGoogleJobsModule");
const { fetchSerpApiGoogleJobs } = require("./serpApiGoogleJobsModule");
const { fetchTheirStackJobs } = require("./theirStackModule");
const { fetchArbeitnowJobs } = require("./arbeitnowModule");
const { fetchAiDevJobs } = require("./aiDevJobsModule");
const { fetchJobDataLakeJobs } = require("./jobDataLakeModule");
const { fetchWhatJobs } = require("./whatJobsModule");
const { fetchAllFindworkJobs } = require("./findworkModule");
const { fetchJobicyJobs } = require("./jobicyModule");
const { fetchJobs: fetchJsearchJobs } = require("./jsearch");
const { fetchRemoteokJobs } = require("./remoteok");
const { fetchRemotiveJobs } = require("./remotiveModule");
const { fetchHimalayasJobs } = require("./himalayasModule");
const { fetchFourDayWeekJobs } = require("./fourDayWeekModule");
const { fetchYCombinatorJobs } = require("./yCombinatorModule");
const { fetchNoFluffJobs } = require("./noFluffJobsModule");
const { fetchWeWorkRemotelyJobs } = require("./weWorkRemotelyModule");

// ---------------------------------------------------------------------------
// Mock fallback (unchanged data, moved here for clarity)
// ---------------------------------------------------------------------------
const MOCK_JOBS = [[""]];

function buildNormalizedJob(title, company, url, region, source) {
  const slug = `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 200);

  return {
    title: (title || "Unknown Position").trim().substring(0, 300),
    company: (company || "Unknown Company").trim().substring(0, 200),
    url: (url || "").trim(),
    region: (region || "Remote").trim().substring(0, 200),
    platformSource: source,
    slug,
    status: determineJobStatus(url),
    scrapedAt: new Date(),
  };
}

function buildMockJobs() {
  return MOCK_JOBS.map((raw) =>
    buildNormalizedJob(raw.title, raw.company, raw.url, raw.region, raw.source),
  );
}

// ---------------------------------------------------------------------------
// Declarative list of all API fetchers
// ---------------------------------------------------------------------------
async function fetchFindworkJobsAdapter(keyword, regions, seenFingerprints) {
  const jobs = await fetchAllFindworkJobs({ search: keyword });
  return jobs.filter((job) => {
    const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
    if (seenFingerprints.has(fp)) return false;
    seenFingerprints.add(fp);
    return true;
  });
}

async function fetchJsearchJobsAdapter(keyword, regions, seenFingerprints) {
  const rawJobs = await fetchJsearchJobs({
    query: keyword,
    page: 1,
    numPages: 1,
    datePosted: "3days",
  });

  const normalized = rawJobs.map((j) => {
    const slug = `${j.title} ${j.company}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 200);

    return {
      title: j.title,
      company: j.company,
      url: j.applyUrl,
      region: j.location || "Remote",
      platformSource: "JSearch",
      slug,
      status: determineJobStatus(j.applyUrl),
      scrapedAt: new Date(),
      source: "jsearch",
      rawId: j.id,
      location: j.location,
      countryCode: "",
      description: j.description,
      salary: { min: null, max: null, currency: null },
      workplaceType: j.workspace,
      postedAt: j.postedAt ? new Date(j.postedAt) : null,
      fetchedAt: new Date(),
    };
  });

  return normalized.filter((job) => {
    const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
    if (seenFingerprints.has(fp)) return false;
    seenFingerprints.add(fp);
    return true;
  });
}

const { getSourceRank } = require("../../utils/sourceRank");

function rankAwareDedup(jobs) {
  const sorted = jobs.slice().sort((a, b) => {
    const ra = getSourceRank(a.url);
    const rb = getSourceRank(b.url);
    if (ra !== rb) return ra - rb;
    return (b.score || 0) - (a.score || 0);
  });
  const seen = new Map();
  const result = [];
  for (const job of sorted) {
    const fp = `${(job.title || "").toLowerCase().trim()}_${(job.company || "").toLowerCase().trim()}`;
    const existingRank = seen.get(fp);
    const newRank = getSourceRank(job.url);
    if (existingRank === undefined || newRank < existingRank) {
      seen.set(fp, newRank);
      const dupIdx = result.findIndex((j) => {
        const efp = `${(j.title || "").toLowerCase().trim()}_${(j.company || "").toLowerCase().trim()}`;
        return efp === fp;
      });
      if (dupIdx !== -1) {
        console.log(
          `[AGG] Replacing Tier-${existingRank} fingerprint "${fp.substring(0, 60)}" with Tier-${newRank}`,
        );
        result[dupIdx] = job;
      } else {
        result.push(job);
      }
    }
  }
  return result;
}

const API_FETCHERS = [
  // {
  //   name: "Adzuna",
  //   isAvailable: () =>
  //     !!(process.env.ADZUNA_APP_ID && process.env.ADZUNA_API_KEY),
  //   fetch: fetchAdzunaJobs,
  // },
  // {
  //   name: "Jooble",
  //   isAvailable: () => !!process.env.JOOBLE_API_KEY,
  //   fetch: fetchJoobleJobs,
  // },
  // {
  //   name: "Careerjet",
  //   isAvailable: () => !!process.env.CAREERJET_API_KEY,
  //   fetch: fetchCareerjetJobs,
  // },
  // {
  //   name: "Reed",
  //   isAvailable: () => !!process.env.REED_API_KEY,
  //   fetch: fetchReedJobs,
  // },
  {
    name: "SerpApi",
    isAvailable: () => !!process.env.SERP_API_KEY,
    fetch: fetchSerpApiGoogleJobs,
  },
  {
    name: "Serper",
    isAvailable: () => !!process.env.SERPER_API_KEY,
    fetch: fetchSerperGoogleJobs,
  },
  {
    name: "Arbeitnow", // always available – no API key required
    isAvailable: () => true,
    fetch: fetchArbeitnowJobs,
  },
  {
    name: "AiDevJobs", // always available – no API key required
    isAvailable: () => true,
    fetch: fetchAiDevJobs,
  },
  // {
  //   name: "JobDataLake",
  //   isAvailable: () => !!process.env.JOBDATALAKE_API_KEY,
  //   fetch: fetchJobDataLakeJobs,
  // },
  // {
  //   name: "WhatJobs",
  //   isAvailable: () => !!process.env.WHATJOBS_API_KEY,
  //   fetch: fetchWhatJobs,
  // },
  // {
  //   name: "Findwork",
  //   isAvailable: () => !!process.env.FINDWORK_API_KEY,
  //   fetch: fetchFindworkJobsAdapter,
  // },
  // {
  //   name: "Jobicy",
  //   isAvailable: () => true,
  //   fetch: fetchJobicyJobs,
  // },
  {
    name: "RemoteOK",
    isAvailable: () => true,
    fetch: fetchRemoteokJobs,
  },
  {
    name: "Remotive",
    isAvailable: () => true,
    fetch: fetchRemotiveJobs,
  },
  {
    name: "Himalayas",
    isAvailable: () => true,
    fetch: fetchHimalayasJobs,
  },
  {
    name: "4dayweek.io",
    isAvailable: () => true,
    fetch: fetchFourDayWeekJobs,
  },
  {
    name: "YCombinator",
    isAvailable: () => true,
    fetch: fetchYCombinatorJobs,
  },
  // {
  //   name: "NoFluffJobs",
  //   fetch: fetchNoFluffJobs,
  //   isAvailable: () =>
  //     process.env.APIFY_API_TOKEN &&
  //     process.env.NOFLUFFJOBS_ENABLED !== "false",
  // },
  // {
  //   name: "NoFluffJobs",
  //   isAvailable: () => {
  //     const hasToken = !!process.env.APIFY_API_TOKEN;
  //     const enabled = process.env.NOFLUFFJOBS_ENABLED !== "false";
  //     const isMorning = new Date().getHours() < 23;
  //     if (hasToken && enabled && !isMorning) {
  //       console.log("[AGG] NoFluffJobs skipped — evening run (cost-saving)");
  //     }
  //     return hasToken && enabled && isMorning;
  //   },
  //   fetch: fetchNoFluffJobs,
  // },
  {
    name: "WeWorkRemotely",
    isAvailable: () => true,
    fetch: fetchWeWorkRemotelyJobs,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function filterAndLog(jobs, apiName, keyword) {
  const filtered = jobs.filter((j) => !shouldExcludeCompany(j.company));
  if (filtered.length < jobs.length) {
    console.log(
      `[AGG] ${apiName} ${keyword}: excluded ${jobs.length - filtered.length} jobs`,
    );
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Main fetch logic
// ---------------------------------------------------------------------------
async function fetchRealJobs() {
  const allJobs = [];
  const { keywords } = aggregatorConfig;
  const seenFingerprints = new Set();

  for (const keyword of keywords) {
    for (const { name, isAvailable, fetch } of API_FETCHERS) {
      if (!isAvailable()) continue;

      try {
        const jobs = await fetch(keyword, undefined, seenFingerprints);
        const filtered = filterAndLog(jobs, name, keyword);
        allJobs.push(...filtered);
      } catch (err) {
        console.error(`[AGG] ${name} ${keyword} failed: ${err.message}`);
      }
    }
  }

  const deduped = rankAwareDedup(allJobs);
  console.log(
    `[AGG] Rank-aware dedup: ${allJobs.length} → ${deduped.length} jobs`,
  );
  return deduped;
}

async function fetchJobs() {
  console.log("[AGG] Running aggregator queries...");
  let jobs;
  try {
    jobs = await fetchRealJobs();
  } catch (err) {
    console.error(`[AGG] Real API pipeline failed: ${err.message}`);
    jobs = [];
  }

  if (jobs.length === 0) {
    console.warn(
      "[AGG] No results from any source. Falling back to mock data.",
    );
    jobs = buildMockJobs();
  }

  console.log(`[AGG] Total aggregator jobs: ${jobs.length}`);
  return jobs;
}

module.exports = { fetchJobs };
