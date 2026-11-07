'use strict';

const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const multer = require('multer');
const Job = require('../models/Job');
const { determineJobStatus } = require('../utils/routing');
const { scoreJob } = require('../services/scorer');

const upload = multer({ storage: multer.memoryStorage() });

const completedIndexes = {};

const { enqueue } = require('../services/ingestQueue');

const RAW_DIR = path.resolve(__dirname, '..', '..', 'data', 'raw-indeed');
const PROCESSED_DIR = path.resolve(__dirname, '..', '..', 'data', 'processed-indeed');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[INDEED] company-filter not found, skipping exclusions');
}

const RESTRICTED_LOCATIONS = /\b(US only|US only applicants|must be (?:a )?US (?:citizen|person)|no C2C|US citizens? only|authorized to work in the US|cannot sponsor)\b/i;

const LOCATION_PATTERNS = [
  /[A-Z]{2,3}\s+\d{4,6}/,
  /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*\s+[A-Z]{2,3}$/,
  /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*,\s+[A-Z]{2}$/,
  /^Remote$/i,
  /Remote\s*[-–—]?\s*[A-Z][a-z]+/i,
  /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/,
];

const KNOWN_LOCATION_TOKENS = new Set([
  'united states', 'united kingdom', 'canada', 'australia', 'usa', 'uk',
  , 'anywhere', 'worldwide', 'global',
]);

function looksLikeUrl(val) {
  return /^https?:\/\//i.test(val) || /indeed\.com\/rc\/clk|indeed\.com\/viewjob/i.test(val);
}

function looksLikeLocation(val) {
  if (!val || val.length > 80) return false;
  if (KNOWN_LOCATION_TOKENS.has(val.toLowerCase().trim())) return true;
  for (var i = 0; i < LOCATION_PATTERNS.length; i++) {
    if (LOCATION_PATTERNS[i].test(val)) return true;
  }
  return /\b(QLD|NSW|VIC|WA|SA|TAS|ACT|NT|TX|CA|NY|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|TN|IN|MO|MD|WI|CO|MN|SC|AL|LA|KY|OR|OK|CT|IA|MS|AR|KS|UT|NV|NM|NE|WV|ID|HI|NH|ME|MT|RI|DE|SD|ND|AK|VT|WY|DC)\b/i.test(val);
}

function looksLikeRating(val) {
  if (!val) return false;
  var n = parseFloat(val);
  return !isNaN(n) && n >= 0 && n <= 5;
}

function parseCsvLine(line) {
  var cells = [];
  var current = '';
  var inQuotes = false;

  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  cells.push(current);
  return cells;
}

function stripHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'");
}

function findTitleColumn(headers, sampleRow) {
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i].toLowerCase();
    if (/jcs-?jobtitle/i.test(h) && !/href/i.test(h)) return i;
    if (/^title$/i.test(h) || /^job.?title$/i.test(h)) return i;
    if (/^position$/i.test(h) || /^role$/i.test(h)) return i;
  }
  if (sampleRow) {
    for (var j = 0; j < sampleRow.length; j++) {
      var cell = (sampleRow[j] || '').trim();
      if (cell.length >= 5 && cell.length <= 120 && !looksLikeUrl(cell) && !looksLikeLocation(cell)) {
        return j;
      }
    }
  }
  return -1;
}

function findUrlColumn(headers, sampleRow) {
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i].toLowerCase();
    if (/href/i.test(h)) return i;
    if (/link|url/i.test(h)) return i;
  }
  if (sampleRow) {
    for (var j = 0; j < sampleRow.length; j++) {
      if (looksLikeUrl(sampleRow[j])) return j;
    }
  }
  return -1;
}

function findCompanyColumn(headers, sampleRow, skipCols) {
  if (sampleRow) {
    for (var j = 0; j < sampleRow.length; j++) {
      if (skipCols.has(j)) continue;
      var cell = (sampleRow[j] || '').trim();
      if (!cell || cell.length < 2 || cell.length > 120) continue;
      if (looksLikeUrl(cell)) continue;
      if (looksLikeRating(cell)) continue;
      if (looksLikeLocation(cell)) continue;
      return j;
    }
  }
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i].toLowerCase();
    if (/company|employer|organization/i.test(h)) return i;
  }
  return -1;
}

function findLocationColumn(headers, sampleRow, skipCols) {
  if (sampleRow) {
    for (var j = 0; j < sampleRow.length; j++) {
      if (skipCols.has(j)) continue;
      var cell = (sampleRow[j] || '').trim();
      if (cell && looksLikeLocation(cell) && cell.length < 80) return j;
    }
  }
  for (var i = 0; i < headers.length; i++) {
    var h = headers[i].toLowerCase();
    if (/location|city|place|region|state/i.test(h)) return i;
  }
  if (sampleRow) {
    for (var k = 0; k < sampleRow.length; k++) {
      if (skipCols.has(k)) continue;
      var c = (sampleRow[k] || '').trim();
      if (c && c.length >= 3 && c.length < 80 && !looksLikeUrl(c) && !looksLikeRating(c)) return k;
    }
  }
  return -1;
}

function buildSlug(title, company) {
  return (title + ' ' + company)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function buildFingerprint(title, company) {
  return (title || '').toLowerCase().trim() + '_' + (company || '').toLowerCase().trim();
}

function parseCsvContent(content, fileName) {
  var lines = content.split(/\r?\n/).filter(function (l) { return l.trim().length > 0; });
  if (lines.length < 2) {
    console.warn('[INDEED] ' + fileName + ': file has fewer than 2 lines');
    return [];
  }

  var headerLine = parseCsvLine(lines[0]);
  var headers = headerLine.map(function (h) { return (h || '').trim(); });

  var sampleRow = lines.length > 1 ? parseCsvLine(lines[1]) : null;

  var colTitle = findTitleColumn(headers, sampleRow);
  var colUrl   = findUrlColumn(headers, sampleRow);

  if (colTitle < 0 || colUrl < 0) {
    console.warn('[INDEED] ' + fileName + ': could not detect title (col=' + colTitle + ') or url (col=' + colUrl + '). Headers:', headers.join(' | '));
    return [];
  }

  var skipCols = new Set([colTitle, colUrl]);
  var colCompany = findCompanyColumn(headers, sampleRow, skipCols);
  if (colCompany >= 0) skipCols.add(colCompany);

  var colLocation = findLocationColumn(headers, sampleRow, skipCols);

  console.log('[INDEED] ' + fileName + ': columns → title=' + colTitle + ' url=' + colUrl + ' company=' + colCompany + ' location=' + colLocation);

  var jobs = [];
  var seen = new Set();

  for (var i = 1; i < lines.length; i++) {
    var cells = parseCsvLine(lines[i]);

    var title   = colTitle >= 0   ? stripHtmlEntities((cells[colTitle]   || '').trim()) : '';
    var url     = colUrl >= 0     ? stripHtmlEntities((cells[colUrl]     || '').trim()) : '';
    var company = colCompany >= 0 ? stripHtmlEntities((cells[colCompany] || '').trim()) : 'Unknown Company';
    var location = colLocation >= 0 ? stripHtmlEntities((cells[colLocation] || '').trim()) : '';

    if (!title || !url) continue;
    if (title.length < 2 || title.length > 300) continue;

    if (RESTRICTED_LOCATIONS.test(title + ' ' + company + ' ' + location)) continue;

    title = title.replace(/\s+/g, ' ').trim();
    company = company.replace(/\s+/g, ' ').trim();
    location = location.replace(/\s+/g, ' ').trim();

    if (company.length < 2) company = 'Unknown Company';
    if (!location || location.length < 2) location = '';

    var fingerprint = buildFingerprint(title, company);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    var slug = buildSlug(title, company);

    var jobObj = {
      title:          title.substring(0, 300),
      company:        company.substring(0, 200),
      url:             url,
      applyUrl:        url,
      region:         location.substring(0, 200),
      location:       location.substring(0, 200),
      platformSource: 'Indeed',
      source:         'indeed',
      slug:           slug,
      fingerprint:    fingerprint,
      scrapedAt:      new Date(),
      fetchedAt:      new Date(),
      status:         determineJobStatus(url),
      description:    '',
      salary:         { min: null, max: null, currency: null },
    };
    var scoring = scoreJob(jobObj);
    jobObj.score = scoring.score;
    jobObj.matchedRules = scoring.matchedRules;
    jobs.push(jobObj);
  }

  return jobs;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function moveFile(src, dest) {
  ensureDir(path.dirname(dest));
  if (fs.existsSync(dest)) {
    var ext = path.extname(dest);
    var base = path.basename(dest, ext);
    var ts = Date.now();
    dest = path.join(path.dirname(dest), base + '-' + ts + ext);
  }
  fs.renameSync(src, dest);
  return dest;
}

async function processAllCsvFiles() {
  var results = { filesProcessed: 0, totalRows: 0, inserted: 0, duplicates: 0, excluded: 0, errors: 0 };

  ensureDir(RAW_DIR);
  ensureDir(PROCESSED_DIR);

  var files = fs.readdirSync(RAW_DIR).filter(function (f) { return /\.csv$/i.test(f); });
  if (files.length === 0) {
    return results;
  }

  console.log('[INDEED] Processing ' + files.length + ' CSV file(s)');

  var allJobs = [];
  var seenFingerprints = new Set();

  var existingFingerprints = await Job.find({ source: 'indeed' }, { slug: 1, title: 1, company: 1 }).lean();
  for (var e = 0; e < existingFingerprints.length; e++) {
    var fp = buildFingerprint(existingFingerprints[e].title, existingFingerprints[e].company);
    seenFingerprints.add(fp);
  }

  for (var f = 0; f < files.length; f++) {
    var filePath = path.join(RAW_DIR, files[f]);
    var content;

    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (readErr) {
      console.error('[INDEED] Failed to read ' + files[f] + ': ' + readErr.message);
      results.errors++;
      continue;
    }

    var jobs = parseCsvContent(content, files[f]);
    console.log('[INDEED] ' + files[f] + ': ' + jobs.length + ' rows parsed');

    for (var j = 0; j < jobs.length; j++) {
      if (shouldExcludeCompany(jobs[j].company)) {
        results.excluded++;
        continue;
      }

      var fp = jobs[j].fingerprint;
      if (seenFingerprints.has(fp)) {
        results.duplicates++;
        continue;
      }
      seenFingerprints.add(fp);
      delete jobs[j].fingerprint;
      allJobs.push(jobs[j]);
    }

    results.filesProcessed++;
    results.totalRows += jobs.length;

    var destPath = path.join(PROCESSED_DIR, files[f]);
    try {
      moveFile(filePath, destPath);
      console.log('[INDEED] Moved ' + files[f] + ' → processed-indeed/');
    } catch (moveErr) {
      console.error('[INDEED] Failed to move ' + files[f] + ': ' + moveErr.message);
    }
  }

  if (allJobs.length === 0) {
    console.log('[INDEED] No new jobs to insert after dedup');
    return results;
  }

  var bulkOps = allJobs.map(function (job) {
    return {
      updateOne: {
        filter: { url: job.url },
        update: { $setOnInsert: job },
        upsert: true,
      },
    };
  });

  try {
    var bulkResult = await Job.bulkWrite(bulkOps, { ordered: false });
    results.inserted = bulkResult.upsertedCount || 0;
    results.duplicates += (bulkOps.length - results.inserted);
    console.log('[INDEED] bulkWrite: ' + results.inserted + ' inserted, ' + (bulkOps.length - results.inserted) + ' url-level dupes');
  } catch (bulkErr) {
    if (bulkErr.name === 'MongoBulkWriteError' && bulkErr.result) {
      results.inserted = bulkErr.result.upsertedCount || bulkErr.result.nInserted || 0;
      results.duplicates += (bulkOps.length - results.inserted);
    } else {
      console.error('[INDEED] bulkWrite failed: ' + bulkErr.message);
      results.errors += bulkOps.length;
    }
  }

  return results;
}

function saveProcessedCopy(filename, buffer) {
  ensureDir(PROCESSED_DIR);
  var ts = Date.now();
  var ext = path.extname(filename);
  var base = path.basename(filename, ext);
  var dest = path.join(PROCESSED_DIR, base + '-' + ts + ext);
  fs.writeFileSync(dest, buffer);
  console.log('[INDEED] Saved processed copy: ' + path.basename(dest));
  return dest;
}

async function processUploadedBuffers(fileBuffers) {
  var results = { filesProcessed: 0, totalRows: 0, inserted: 0, duplicates: 0, excluded: 0, errors: 0 };

  var allJobs = [];
  var seenFingerprints = new Set();

  var existingFingerprints = await Job.find({ source: 'indeed' }, { slug: 1, title: 1, company: 1 }).lean();
  for (var e = 0; e < existingFingerprints.length; e++) {
    var fp = buildFingerprint(existingFingerprints[e].title, existingFingerprints[e].company);
    seenFingerprints.add(fp);
  }

  for (var i = 0; i < fileBuffers.length; i++) {
    var fileObj = fileBuffers[i];
    var content;

    try {
      content = fileObj.buffer.toString('utf-8');
    } catch (readErr) {
      console.error('[INDEED] Failed to decode ' + fileObj.originalname + ': ' + readErr.message);
      results.errors++;
      continue;
    }

    var jobs = parseCsvContent(content, fileObj.originalname);
    console.log('[INDEED] ' + fileObj.originalname + ': ' + jobs.length + ' rows parsed');

    for (var j = 0; j < jobs.length; j++) {
      if (shouldExcludeCompany(jobs[j].company)) {
        results.excluded++;
        continue;
      }

      var fp = jobs[j].fingerprint;
      if (seenFingerprints.has(fp)) {
        results.duplicates++;
        continue;
      }
      seenFingerprints.add(fp);
      delete jobs[j].fingerprint;
      allJobs.push(jobs[j]);
    }

    results.filesProcessed++;
    results.totalRows += jobs.length;

    try {
      saveProcessedCopy(fileObj.originalname, fileObj.buffer);
    } catch (saveErr) {
      console.error('[INDEED] Failed to save copy of ' + fileObj.originalname + ': ' + saveErr.message);
    }
  }

  if (allJobs.length === 0) {
    console.log('[INDEED] No new jobs to insert after dedup');
    return results;
  }

  var bulkOps = allJobs.map(function (job) {
    return {
      updateOne: {
        filter: { url: job.url },
        update: { $setOnInsert: job },
        upsert: true,
      },
    };
  });

  try {
    var bulkResult = await Job.bulkWrite(bulkOps, { ordered: false });
    results.inserted = bulkResult.upsertedCount || 0;
    results.duplicates += (bulkOps.length - results.inserted);
    console.log('[INDEED] bulkWrite: ' + results.inserted + ' inserted, ' + (bulkOps.length - results.inserted) + ' url-level dupes');
  } catch (bulkErr) {
    if (bulkErr.name === 'MongoBulkWriteError' && bulkErr.result) {
      results.inserted = bulkErr.result.upsertedCount || bulkErr.result.nInserted || 0;
      results.duplicates += (bulkOps.length - results.inserted);
    } else {
      console.error('[INDEED] bulkWrite failed: ' + bulkErr.message);
      results.errors += bulkOps.length;
    }
  }

  return results;
}

const router = Router();

router.post('/import', async function (req, res, next) {
  try {
    var results = await processAllCsvFiles();
    if (results.filesProcessed === 0) {
      return res.json({ message: 'No CSV files found in data/raw-indeed/', ...results });
    }
    res.json(results);
  } catch (err) {
    console.error('[INDEED] Import pipeline failed: ' + err.message);
    next(err);
  }
});

router.get('/files', function (_req, res) {
  try {
    ensureDir(RAW_DIR);
    ensureDir(PROCESSED_DIR);
    var rawFiles = fs.readdirSync(RAW_DIR).filter(function (f) { return /\.csv$/i.test(f); });
    var processedFiles = fs.readdirSync(PROCESSED_DIR).filter(function (f) { return /\.csv$/i.test(f); });
    res.json({ raw: rawFiles, processed: processedFiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload', upload.array('files'), async function (req, res, next) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No CSV files uploaded' });
    }

    console.log('[INDEED] Received ' + req.files.length + ' file(s) via upload');

    var results = await processUploadedBuffers(req.files);

    res.json({
      success: true,
      filesProcessed: results.filesProcessed,
      totalRows: results.totalRows,
      inserted: results.inserted,
      skippedDuplicates: results.duplicates,
      excluded: results.excluded,
      errors: results.errors,
    });
  } catch (err) {
    console.error('[INDEED] Upload pipeline failed: ' + err.message);
    next(err);
  }
});

async function processRawJobs(rawJobs) {
  console.log('[INDEED] Processing ' + rawJobs.length + ' raw jobs in background');

  var results = { inserted: 0, skippedDuplicates: 0, excluded: 0, errors: 0 };

  var seenFingerprints = new Set();
  var existingFingerprints = await Job.find({ source: 'indeed' }, { slug: 1, title: 1, company: 1 }).lean();
  for (var e = 0; e < existingFingerprints.length; e++) {
    var fp = buildFingerprint(existingFingerprints[e].title, existingFingerprints[e].company);
    seenFingerprints.add(fp);
  }

  var bulkOps = [];

  for (var i = 0; i < rawJobs.length; i++) {
    var raw = rawJobs[i];
    if (!raw || typeof raw !== 'object') { results.errors++; continue; }

    var title    = stripHtmlEntities((raw.title    || '').trim()).replace(/\s+/g, ' ');
    var company  = stripHtmlEntities((raw.company  || '').trim()).replace(/\s+/g, ' ');
    var location = stripHtmlEntities((raw.location || raw.loc || '').trim()).replace(/\s+/g, ' ');
    var url      = (raw.url || raw.link || raw.applyUrl || raw.href || '').trim();

    if (!title || !url) { results.errors++; continue; }
    if (title.length < 2 || title.length > 300) { results.errors++; continue; }
    if (company.length < 2) company = 'Unknown Company';
    if (!location || location.length < 2) location = '';

    if (shouldExcludeCompany(company)) { results.excluded++; continue; }

    if (RESTRICTED_LOCATIONS.test(title + ' ' + company + ' ' + location)) { results.excluded++; continue; }

    var fingerprint = buildFingerprint(title, company);
    if (seenFingerprints.has(fingerprint)) { results.skippedDuplicates++; continue; }
    seenFingerprints.add(fingerprint);

    var slug = buildSlug(title, company);

    var jobPayload = {
      title:          title.substring(0, 300),
      company:        company.substring(0, 200),
      url:             url,
      applyUrl:        url,
      region:         location.substring(0, 200),
      location:       location.substring(0, 200),
      platformSource: 'Indeed',
      source:         'indeed',
      slug:           slug,
      scrapedAt:      new Date(),
      fetchedAt:      new Date(),
      status:         determineJobStatus(url),
      description:    '',
      salary:         { min: null, max: null, currency: null },
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
      var bulkResult = await Job.bulkWrite(bulkOps, { ordered: false });
      results.inserted = bulkResult.upsertedCount || 0;
      results.skippedDuplicates += (bulkOps.length - results.inserted);
      console.log('[INDEED] JSON upload bulkWrite: ' + results.inserted + ' inserted, ' + (bulkOps.length - results.inserted) + ' url-level dupes');
    } catch (bulkErr) {
      if (bulkErr.name === 'MongoBulkWriteError' && bulkErr.result) {
        results.inserted = bulkErr.result.upsertedCount || bulkErr.result.nInserted || 0;
        results.skippedDuplicates += (bulkOps.length - results.inserted);
      } else {
        console.error('[INDEED] JSON upload bulkWrite failed: ' + bulkErr.message);
        results.errors += bulkOps.length;
      }
    }
  }

  return results;
}

router.post('/upload-json', function (req, res) {
  var body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object with scrapeIdx and jobs' });
  }

  var scrapeIdx = body.scrapeIdx != null ? parseInt(body.scrapeIdx, 10) : -1;
  var rawJobs = body.jobs;

  if (!Array.isArray(rawJobs)) {
    return res.status(400).json({ error: 'Body must contain a "jobs" array' });
  }

  // Resolve the loop immediately so the frontend never blocks on DB/LLM work.
  if (scrapeIdx >= 0) completedIndexes[scrapeIdx] = true;

  if (rawJobs.length === 0) {
    console.log('[INDEED] Received empty jobs array for idx=' + scrapeIdx + ' via JSON upload');
    return res.json({ success: true, queued: 0 });
  }

  console.log('[INDEED] Received ' + rawJobs.length + ' raw jobs for idx=' + scrapeIdx + ' — queued for background processing');

  res.json({ success: true, queued: rawJobs.length });

  enqueue(function () {
    return processRawJobs(rawJobs).then(function (results) {
      console.log('[INDEED] Background processing complete for idx=' + scrapeIdx + ': ' + results.inserted + ' inserted, ' + results.skippedDuplicates + ' dupes');
    });
  });
});

router.get('/status', function (req, res) {
  var idx = parseInt(req.query.idx, 10);
  if (isNaN(idx) || idx < 0) {
    return res.status(400).json({ error: 'Query parameter "idx" must be a non-negative integer' });
  }
  res.json({ completed: !!completedIndexes[idx] });
});

router.post('/reset', function (_req, res) {
  for (var k in completedIndexes) delete completedIndexes[k];
  res.json({ reset: true });
});

module.exports = { router, processAllCsvFiles, RAW_DIR };
