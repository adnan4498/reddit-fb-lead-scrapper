"use strict";

const { Router } = require("express");
const Job = require("../models/Job");
const { determineJobStatus } = require("../utils/routing");
const { scoreJob } = require("../services/scorer");

const completedIndexes = {};

const { enqueue } = require("../services/ingestQueue");

let shouldExcludeCompany;
try {
  shouldExcludeCompany =
    require("../../scripts/lib/company-filter").shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn("[GLASSDOOR] company-filter not found, skipping exclusions");
}

const RESTRICTED_LOCATIONS =
  /\b(US only|US only applicants|must be (?:a )?US (?:citizen|person)|no C2C|US citizens? only|authorized to work in the US|cannot sponsor)\b/i;

function buildSlug(title, company) {
  return (title + " " + company)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 200);
}

function buildFingerprint(title, company) {
  return (
    (title || "").toLowerCase().trim() +
    "_" +
    (company || "").toLowerCase().trim()
  );
}

const router = Router();

async function processRawJobs(rawJobs) {
  console.log(
    "[GLASSDOOR] Processing " + rawJobs.length + " jobs in background",
  );

  var seenFingerprints = new Set();
  var existing = await Job.find(
    { source: "glassdoor" },
    { title: 1, company: 1 },
  ).lean();
  for (var e = 0; e < existing.length; e++) {
    seenFingerprints.add(
      buildFingerprint(existing[e].title, existing[e].company),
    );
  }

  var results = { inserted: 0, skippedDuplicates: 0, excluded: 0, errors: 0 };
  var bulkOps = [];

  for (var i = 0; i < rawJobs.length; i++) {
    var raw = rawJobs[i];
    if (!raw || typeof raw !== "object") {
      results.errors++;
      continue;
    }

    var title = (raw.title || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"');
    var company = (raw.company || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/&amp;/g, "&");
    var location = (raw.location || raw.loc || "").trim().replace(/\s+/g, " ");
    var url = (raw.url || raw.link || raw.applyUrl || raw.href || "").trim();

    if (!title || !url) {
      results.errors++;
      continue;
    }
    if (title.length < 2 || title.length > 300) {
      results.errors++;
      continue;
    }
    if (company.length < 2) company = "Unknown Company";
    if (!location || location.length < 2) location = "";

    if (shouldExcludeCompany(company)) {
      results.excluded++;
      continue;
    }
    if (RESTRICTED_LOCATIONS.test(title + " " + company + " " + location)) {
      results.excluded++;
      continue;
    }

    var fp = buildFingerprint(title, company);
    if (seenFingerprints.has(fp)) {
      results.skippedDuplicates++;
      continue;
    }
    seenFingerprints.add(fp);

    var jobPayload = {
      title: title.substring(0, 300),
      company: company.substring(0, 200),
      url: url,
      applyUrl: url,
      region: location.substring(0, 200),
      location: location.substring(0, 200),
      platformSource: "Glassdoor",
      source: "glassdoor",
      slug: buildSlug(title, company),
      scrapedAt: new Date(),
      fetchedAt: new Date(),
      status: determineJobStatus(url),
      description: (raw.description || "").substring(0, 5000),
      salary: { min: null, max: null, currency: null },
    };
    var scoring = scoreJob(jobPayload);
    jobPayload.score = scoring.score;
    jobPayload.matchedRules = scoring.matchedRules;

    bulkOps.push({
      updateOne: {
        filter: { url: url },
        update: { $setOnInsert: jobPayload },
        upsert: true,
      },
    });
  }

  if (bulkOps.length > 0) {
    try {
      var br = await Job.bulkWrite(bulkOps, { ordered: false });
      results.inserted = br.upsertedCount || 0;
      results.skippedDuplicates += bulkOps.length - results.inserted;
      console.log(
        "[GLASSDOOR] bulkWrite: " +
          results.inserted +
          " inserted, " +
          (bulkOps.length - results.inserted) +
          " url-dupes",
      );
    } catch (bulkErr) {
      if (bulkErr.name === "MongoBulkWriteError" && bulkErr.result) {
        results.inserted =
          bulkErr.result.upsertedCount || bulkErr.result.nInserted || 0;
        results.skippedDuplicates += bulkOps.length - results.inserted;
      } else {
        console.error("[GLASSDOOR] bulkWrite failed: " + bulkErr.message);
        results.errors += bulkOps.length;
      }
    }
  }

  return results;
}

router.post("/upload-json", function (req, res) {
  var body = req.body;
  if (!body || typeof body !== "object") {
    return res
      .status(400)
      .json({ error: "Body must be a JSON object with scrapeIdx and jobs" });
  }

  var scrapeIdx = body.scrapeIdx != null ? parseInt(body.scrapeIdx, 10) : -1;
  var rawJobs = body.jobs;

  if (!Array.isArray(rawJobs)) {
    return res.status(400).json({ error: 'Body must contain a "jobs" array' });
  }

  // Resolve the loop immediately so the frontend never blocks on DB/LLM work.
  if (scrapeIdx >= 0) completedIndexes[scrapeIdx] = true;

  if (rawJobs.length === 0) {
    console.log("[GLASSDOOR] Empty jobs for idx=" + scrapeIdx);
    return res.json({ success: true, queued: 0 });
  }

  console.log(
    "[GLASSDOOR] Received " +
      rawJobs.length +
      " jobs for idx=" +
      scrapeIdx +
      " — queued for background processing",
  );

  res.json({ success: true, queued: rawJobs.length });

  enqueue(function () {
    return processRawJobs(rawJobs).then(function (results) {
      console.log(
        "[GLASSDOOR] Background processing complete for idx=" +
          scrapeIdx +
          ": " +
          results.inserted +
          " inserted",
      );
    });
  });
});

router.get("/status", function (req, res) {
  var idx = parseInt(req.query.idx, 10);
  if (isNaN(idx) || idx < 0) {
    return res
      .status(400)
      .json({ error: 'Query param "idx" must be a non-negative integer' });
  }
  res.json({ completed: !!completedIndexes[idx] });
});

router.post("/reset", function (_req, res) {
  for (var k in completedIndexes) delete completedIndexes[k];
  res.json({ reset: true });
});

module.exports = router;
