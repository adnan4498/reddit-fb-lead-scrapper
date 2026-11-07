const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[NOFLUFFJOBS] company-filter not found, skipping exclusions');
}

const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID = 'wMFH8ra7Tp9aWWhVl';
const MAX_RESULTS = parseInt(process.env.NOFLUFFJOBS_MAX_RESULTS || '10', 10);

const POLL_INTERVAL_MS = 4000;
// const MAX_POLL_ATTEMPTS = 90;
const MAX_POLL_ATTEMPTS = 5;
const ONE_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function parseSalary(raw) {
  if (!raw) return { min: null, max: null, currency: null };

  if (typeof raw === 'object' && raw !== null) {
    const from = raw.from || raw.min || raw.minSalary || raw.salaryMin || null;
    const to = raw.to || raw.max || raw.maxSalary || raw.salaryMax || null;
    const currency = raw.currency || raw.salaryCurrency || raw.currencyCode || null;
    return {
      min: from != null ? Number(from) : null,
      max: to != null ? Number(to) : null,
      currency: currency || null,
    };
  }

  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^0-9.,\- ]/g, '').trim();
    const parts = cleaned.split(/[-–—]/).map((s) => {
      const n = parseFloat(s.replace(/[^0-9.]/g, ''));
      return isNaN(n) ? null : n;
    });
    let currency = null;
    if (/\$/g.test(raw)) currency = 'USD';
    else if (/£/g.test(raw)) currency = 'GBP';
    else if (/€/g.test(raw)) currency = 'EUR';
    else if (/PLN|zł|zl/i.test(raw)) currency = 'PLN';

    return {
      min: parts[0] || null,
      max: parts[1] || null,
      currency,
    };
  }

  return { min: null, max: null, currency: null };
}

function normalizeResult(raw, keyword) {
  if (!raw || typeof raw !== 'object') return null;

  const title = (
    raw.title ||
    raw.jobTitle ||
    raw.position ||
    raw.name ||
    ''
  ).trim().substring(0, 300);

  const company = (
    raw.companyName ||
    raw.company ||
    raw.employer ||
    raw.employerName ||
    raw.organization ||
    'Unknown Company'
  ).trim().substring(0, 200);

  const applyUrl = (
    raw.url ||
    raw.applyUrl ||
    raw.applicationUrl ||
    raw.link ||
    raw.href ||
    ''
  ).trim();

  const locationName = (
    raw.location ||
    raw.city ||
    raw.place ||
    raw.address ||
    ''
  ).trim();

  const region = locationName || 'Remote';
  const countryCode = (raw.countryCode || raw.country || '').toLowerCase().substring(0, 2);
  const description = stripHtml(raw.description || raw.summary || raw.snippet || '');
  const postedAt = parseDate(raw.postedAt || raw.publicationDate || raw.datePosted || raw.date);
  const salary = parseSalary(raw.salary || raw.salaryRange || raw.remuneration);
  const rawId = raw.id != null ? String(raw.id) : (raw.slug || raw._id || applyUrl);
  const workplaceType = (
    raw.remote === true || raw.remote === 'true' || raw.remote === 1 ||
    String(raw.workplaceType || raw.workplace || '').toLowerCase() === 'remote'
  ) ? 'remote' : 'onsite';

  if (!title || !company) return null;

  const now = Date.now();
  if (postedAt && (now - postedAt.getTime()) > ONE_DAYS_MS) {
    return null;
  }

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url: applyUrl,
    applyUrl,
    region: region.substring(0, 200),
    platformSource: 'NoFluffJobs',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'nofluffjobs',
    rawId,
    location: locationName,
    countryCode,
    description,
    salary,
    workplaceType,
    postedAt,
    fetchedAt: new Date(),
  };
}

async function startApifyRun(keyword) {
  const stateKey = `nofluffjobs-${keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  const input = {
    query: keyword,
    maxResults: MAX_RESULTS,
    includeDetails: true,
    incrementalMode: false,
    // stateKey,
    emitUnchanged: false,
    emitExpired: false,
    skipReposts: true,
    compact: false,
    country: '',
  };

  console.log(`[NOFLUFFJOBS] Starting Apify run for "${keyword}" (maxResults: ${MAX_RESULTS})`);

  const response = await fetchWithRetry(
    () =>
      axios.post(`${APIFY_BASE}/acts/${ACTOR_ID}/runs`, input, {
        headers: {
          Authorization: `Bearer ${APIFY_TOKEN}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }),
    `NoFluffJobs/start/${keyword}`
  );

  const runData = response.data && response.data.data;
  if (!runData || !runData.id) {
    throw new Error('Apify run start response missing run ID');
  }

  console.log(`[NOFLUFFJOBS] Apify run started: ${runData.id}`);
  return { runId: runData.id, defaultDatasetId: runData.defaultDatasetId };
}

async function pollRunStatus(runId) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    const response = await fetchWithRetry(
      () =>
        axios.get(`${APIFY_BASE}/actor-runs/${runId}`, {
          headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
          timeout: 15000,
        }),
      `NoFluffJobs/poll/${runId}`
    );

    const runData = response.data && response.data.data;
    if (!runData) {
      console.warn(`[NOFLUFFJOBS] Poll attempt ${attempt}: no data in response`);
    } else {
      const status = runData.status;

      if (status === 'SUCCEEDED') {
        console.log(`[NOFLUFFJOBS] Run ${runId} SUCCEEDED after ${attempt} poll(s)`);
        return runData;
      }

      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        throw new Error(`Apify run ended with status: ${status}`);
      }

      if (attempt % 5 === 0) {
        console.log(
          `[NOFLUFFJOBS] Run ${runId} still ${status} (poll ${attempt}/${MAX_POLL_ATTEMPTS})`
        );
      }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Apify run ${runId} did not complete within ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s`);
}

async function fetchDatasetItems(datasetId) {
  const response = await fetchWithRetry(
    () =>
      axios.get(`${APIFY_BASE}/datasets/${datasetId}/items`, {
        params: { format: 'json' },
        headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
        timeout: 30000,
      }),
    `NoFluffJobs/dataset/${datasetId}`
  );

  const items = response.data;
  if (!Array.isArray(items) || items.length === 0) {
    console.log(`[NOFLUFFJOBS] Dataset ${datasetId}: empty`);
    return [];
  }

  console.log(`[NOFLUFFJOBS] Dataset ${datasetId}: ${items.length} raw items`);
  return items;
}

async function fetchNoFluffJobs(keyword, regions, seenFingerprints) {
  if (!APIFY_TOKEN) {
    console.error('[NOFLUFFJOBS] APIFY_API_TOKEN not configured. Skipping.');
    return [];
  }

  const allJobs = [];

  try {
    const { runId, defaultDatasetId } = await startApifyRun(keyword);

    const completedRun = await pollRunStatus(runId);

    const datasetId = completedRun.defaultDatasetId || defaultDatasetId;
    if (!datasetId) {
      console.error('[NOFLUFFJOBS] No dataset ID available after run completion.');
      return [];
    }

    const rawItems = await fetchDatasetItems(datasetId);

    const jobs = rawItems
      .map((raw) => normalizeResult(raw, keyword))
      .filter((job) => job && job.title && job.company && job.url)
      .filter((job) => !shouldExcludeCompany(job.company));

    const uniqueJobs = jobs.filter((job) => {
      if (seenFingerprints.has(job.fingerprint)) return false;
      seenFingerprints.add(job.fingerprint);
      return true;
    });

    for (const j of uniqueJobs) delete j.fingerprint;
    allJobs.push(...uniqueJobs);

    console.log(
      `[NOFLUFFJOBS] "${keyword}": ${uniqueJobs.length} jobs ` +
      `(${rawItems.length} raw, ${jobs.length} filtered, ${jobs.length - uniqueJobs.length} dupes)`
    );
  } catch (err) {
    console.error(`[NOFLUFFJOBS] "${keyword}" failed: ${err.message}`);
    return [];
  }

  return allJobs;
}

module.exports = { fetchNoFluffJobs };
