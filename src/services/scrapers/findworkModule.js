const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');

const API_KEY = process.env.FINDWORK_API_KEY;
const BASE_URL = 'https://findwork.dev/api/jobs/';
const MAX_PAGES = 2;

// ---- Freshness filter ----
const ONE_DAYS_MS = 2 * 24 * 60 * 60 * 1000; // 3 days in milliseconds

let shouldExcludeCompanyFn;
try {
  shouldExcludeCompanyFn = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompanyFn = () => false;
  console.warn('[FINDWORK] company-filter not found, skipping exclusions');
}

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeResult(raw) {
  const title = (raw.role || raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company_name || raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.url || raw.application_url || '').trim();
  const location = (raw.location || '').trim();
  const remote = raw.remote === true || raw.remote === 'true' || raw.remote === 1;

  // Parse posted date
  let postedAt = null;
  if (raw.date_posted) {
    const d = new Date(raw.date_posted);
    if (!isNaN(d.getTime())) postedAt = d;
  }

  return {
    title,
    company,
    url,
    region: location || (remote ? 'Remote' : 'Unknown'),
    platformSource: 'Findwork',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'findwork',
    rawId: raw.id != null ? String(raw.id) : '',
    location,
    remote,
    countryCode: '',
    description: '',
    salary: { min: null, max: null, currency: null },
    postedAt,                      // now properly parsed
    fetchedAt: new Date(),
  };
}

async function fetchFindworkJobs(filters = {}) {
  if (!API_KEY) {
    console.error('[FINDWORK] FINDWORK_API_KEY is not configured. Skipping.');
    return [];
  }

  const { search = '', location = '', remote = false, page = 1 } = filters;

  const params = { page };
  if (search) params.search = search;
  if (location) params.location = location;
  if (remote) params.remote = 'true';

  try {
    const response = await fetchWithRetry(
      () =>
        axios.get(BASE_URL, {
          params,
          headers: {
            Authorization: `Token ${API_KEY}`,
            Accept: 'application/json',
          },
          timeout: 30000,
          validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
        }),
      `Findwork/page${page}`
    );

    if (response.status === 404) {
      console.warn(`[FINDWORK] 404 — page ${page} not found, end of results`);
      return [];
    }

    const rawData = response.data && (response.data.results || response.data.data || response.data.jobs);
    if (!Array.isArray(rawData) || rawData.length === 0) {
      console.log(`[FINDWORK] page ${page}: empty result set`);
      return [];
    }

    const now = Date.now();

    const jobs = rawData
      .map((raw) => normalizeResult(raw))
      .filter((job) => {
        // Basic validation
        if (!job.title || !job.company) return false;
        if (shouldExcludeCompanyFn(job.company)) return false;

        // ---- FRESHNESS FILTER: keep only jobs posted within the last 3 days ----
        if (job.postedAt) {
          const age = now - job.postedAt.getTime();
          if (age > ONE_DAYS_MS) {
            // Skip older jobs
            return false;
          }
        } else {
          // If no date is provided, we keep the job but log a warning
          console.warn(`[FINDWORK] Job has no posted date: "${job.title}" at ${job.company}`);
        }

        return true;
      });

    console.log(`[FINDWORK] page ${page}: ${jobs.length} jobs fetched (filtered by 3-day freshness)`);
    return jobs;
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      if (status === 401) {
        console.error('[FINDWORK] Authentication failed (401). Check FINDWORK_API_KEY.');
      } else if (status === 403) {
        console.error('[FINDWORK] Access forbidden (403). API key may lack permissions or be rate-limited.');
      } else if (status === 429) {
        console.error('[FINDWORK] Rate limited (429).');
      } else {
        console.error(`[FINDWORK] HTTP ${status}: ${err.message}`);
      }
    } else {
      console.error(`[FINDWORK] Request failed: ${err.message}`);
    }
    return [];
  }
}

async function fetchAllFindworkJobs(filters = {}) {
  if (!API_KEY) {
    console.error('[FINDWORK] FINDWORK_API_KEY is not configured. Skipping.');
    return [];
  }

  const allJobs = [];
  const seenFingerprints = new Set();

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const pageFilters = { ...filters, page };
      const pageJobs = await fetchFindworkJobs(pageFilters);

      if (pageJobs.length === 0) {
        console.log(`[FINDWORK] page ${page}: no results, stopping pagination`);
        break;
      }

      // Dedup within this run using fingerprint
      const uniqueJobs = pageJobs.filter((job) => {
        const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
        if (seenFingerprints.has(fp)) return false;
        seenFingerprints.add(fp);
        return true;
      });

      if (uniqueJobs.length === 0) {
        console.log(`[FINDWORK] page ${page}: all duplicates, breaking`);
        break;
      }

      allJobs.push(...uniqueJobs);
      console.log(
        `[FINDWORK] page ${page}: ${uniqueJobs.length} unique jobs ` +
        `(${pageJobs.length - uniqueJobs.length} dupe-skipped)`
      );

      // If fewer than 20 results, assume we reached the last page
      if (pageJobs.length < 20) {
        console.log(`[FINDWORK] page ${page}: last page (fewer than 20 results)`);
        break;
      }
    } catch (err) {
      console.error(`[FINDWORK] page ${page} pagination error: ${err.message}`);
      break;
    }
  }

  console.log(`[FINDWORK] all-pages total: ${allJobs.length} unique jobs`);
  return allJobs;
}

module.exports = { fetchFindworkJobs, fetchAllFindworkJobs };