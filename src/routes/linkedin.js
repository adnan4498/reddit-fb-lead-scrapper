'use strict';

const { Router } = require('express');
const Job = require('../models/Job');
const { determineJobStatus } = require('../utils/routing');
const { scoreJob } = require('../services/scorer');

const completedIndexes = {};

const { enqueue } = require('../services/ingestQueue');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[LINKEDIN] company-filter not found, skipping exclusions');
}

const RESTRICTED_LOCATIONS = /\b(US only|US only applicants|must be (?:a )?US (?:citizen|person)|no C2C|US citizens? only|authorized to work in the US|cannot sponsor)\b/i;

// ── UPDATED: append unique identifier from URL ──
function buildSlug(title, company, url) {
  const base = (title + ' ' + company)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 150);
  // Use the last part of the URL (job ID) as unique suffix
  const id = url.split('/').pop() || Math.random().toString(36).substring(2, 8);
  return base + '-' + id;
}

const router = Router();

async function processRawJobs(rawJobs) {
  console.log('[LINKEDIN] Processing ' + rawJobs.length + ' jobs in background');

  const sampleUrls = rawJobs.slice(0, 5).map(function (j) { return j.url; });
  console.log('[LINKEDIN] Sample URLs:', sampleUrls);

  const bulkOps = [];

  for (const raw of rawJobs) {
    if (!raw || typeof raw !== 'object') continue;

    let title    = (raw.title    || '').trim().replace(/\s+/g, ' ').replace(/&amp;/g, '&');
    let company  = (raw.company  || '').trim().replace(/\s+/g, ' ').replace(/&amp;/g, '&');
    let location = (raw.location || '').trim().replace(/\s+/g, ' ');
    let url      = (raw.url || raw.link || '').trim();

    if (!title || !url) continue;
    if (title.length < 2 || title.length > 300) continue;
    if (company.length < 2) company = 'Unknown Company';

    if (shouldExcludeCompany(company)) continue;
    if (RESTRICTED_LOCATIONS.test(title + ' ' + company + ' ' + location)) continue;

    const jobPayload = {
      title:          title.substring(0, 300),
      company:        company.substring(0, 200),
      url:            url,
      applyUrl:       url,
      region:         location.substring(0, 200),
      location:       location.substring(0, 200),
      platformSource: 'LinkedIn',
      source:         'linkedin',
      slug:           buildSlug(title, company, url),
      scrapedAt:      new Date(),
      fetchedAt:      new Date(),
      status:         determineJobStatus(url),
      description:    (raw.description || '').substring(0, 5000),
      salary:         { min: null, max: null, currency: null },
      postedAt:       raw.postedAt ? new Date(raw.postedAt) : null,
    };
    const scoring = scoreJob(jobPayload);
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

  console.log('[LINKEDIN] Jobs to insert: ' + bulkOps.length);

  let inserted = 0;
  if (bulkOps.length > 0) {
    try {
      const br = await Job.bulkWrite(bulkOps, { ordered: false });
      inserted = br.upsertedCount || 0;
      console.log('[LINKEDIN] bulkWrite: ' + inserted + ' inserted, ' + (bulkOps.length - inserted) + ' url-dupes');
    } catch (bulkErr) {
      if (bulkErr.name === 'MongoBulkWriteError' && bulkErr.result) {
        inserted = bulkErr.result.upsertedCount || bulkErr.result.nInserted || 0;
        console.log('[LINKEDIN] bulkWrite (partial): ' + inserted + ' inserted');
      } else {
        console.error('[LINKEDIN] bulkWrite failed: ' + bulkErr.message);
      }
    }
  }

  return { inserted };
}

router.post('/upload-json', function (req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object with scrapeIdx and jobs' });
  }

  const scrapeIdx = body.scrapeIdx != null ? parseInt(body.scrapeIdx, 10) : -1;
  const rawJobs = body.jobs;

  if (!Array.isArray(rawJobs)) {
    return res.status(400).json({ error: 'Body must contain a "jobs" array' });
  }

  // Resolve the loop immediately so the frontend never blocks on DB/LLM work.
  if (scrapeIdx >= 0) completedIndexes[scrapeIdx] = true;

  if (rawJobs.length === 0) {
    console.log('[LINKEDIN] Empty jobs for idx=' + scrapeIdx);
    return res.json({ success: true, queued: 0 });
  }

  console.log('[LINKEDIN] Received ' + rawJobs.length + ' jobs for idx=' + scrapeIdx + ' — queued for background processing');

  res.json({ success: true, queued: rawJobs.length });

  enqueue(function () {
    return processRawJobs(rawJobs).then(function (results) {
      console.log('[LINKEDIN] Background processing complete for idx=' + scrapeIdx + ': ' + (results.inserted || 0) + ' inserted');
    });
  });
});

router.get('/status', function (req, res) {
  const idx = parseInt(req.query.idx, 10);
  if (isNaN(idx) || idx < 0) {
    return res.status(400).json({ error: 'Query param "idx" must be a non-negative integer' });
  }
  res.json({ completed: !!completedIndexes[idx] });
});

router.post('/reset', function (_req, res) {
  for (var k in completedIndexes) delete completedIndexes[k];
  res.json({ reset: true });
});

module.exports = router;