const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[AIDEVJOBS] company-filter not found, skipping exclusions');
}

const BASE_URL = 'https://aidevboard.com/api/v1/jobs';
const MAX_PAGES = 2; // safety cap – we'll almost never hit it because we break early on old jobs
const ONE_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeResult(raw, region) {
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company_name || raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.url || raw.apply_url || raw.link || '').trim();
  const locationName = (raw.location || raw.city || '').trim();

  let postedAt = null;
  const dateRaw = raw.created_at || raw.date_posted || raw.published_at || raw.date || null;
  if (dateRaw != null) {
    const ts = typeof dateRaw === 'number' ? dateRaw : new Date(dateRaw).getTime();
    if (!isNaN(ts)) {
      postedAt = new Date(ts < 1000000000000 ? ts * 1000 : ts);
      if (isNaN(postedAt.getTime())) postedAt = null;
    }
  }

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region: locationName || region.toUpperCase(),
    platformSource: 'aidevjobs',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'aidevjobs',
    rawId: raw.id != null ? String(raw.id) : url,
    location: locationName,
    countryCode: region.toLowerCase(),
    description: (raw.description || raw.summary || '').trim(),
    salary: {
      min: raw.salary_min != null ? Number(raw.salary_min) : null,
      max: raw.salary_max != null ? Number(raw.salary_max) : null,
      currency: raw.salary_currency || null,
    },
    postedAt,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region, page) {
  const response = await fetchWithRetry(
    () =>
      axios.get(BASE_URL, {
        params: {
          q: keyword,
          page,
          limit: 50, // API max is 50 – we use it to get as many as possible per request
          ...(region && region !== 'intl' ? { location: region } : {}),
        },
        timeout: 30000,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
      }),
    `AiDevJobs/${keyword}/page${page}`
  );

  if (response.status === 404) return [];

  const data = response.data && (response.data.data || response.data.jobs || response.data.results);
  if (!Array.isArray(data) || data.length === 0) return [];

  const now = Date.now();
  const normalized = data
    .map((raw) => normalizeResult(raw, region))
    .filter((job) => {
      // Basic validation
      if (!job.title || !job.company) return false;
      if (shouldExcludeCompany && shouldExcludeCompany(job.company)) return false;

      // ⏰ Freshness filter: keep only jobs posted within the last 4 days
      if (job.postedAt) {
        const age = now - job.postedAt.getTime();
        if (age > ONE_DAYS_MS) {
          // Job is older than 4 days – we return false to filter it out
          return false;
        }
      } else {
        // If a job has no date, we keep it to be safe, but warn (once per page) 
        // since we can't verify freshness.
        // You can change this to `return false` if you strictly want only dated jobs.
        // console.warn('[AIDEVJOBS] Job missing postedAt, keeping anyway:', job.title);
      }
      return true;
    });

  return normalized;
}

async function fetchAiDevJobs(
  keyword,
  regions = ['intl'],
  seenFingerprints = new Set()
) {
  const allJobs = [];

  for (const region of regions) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const pageJobs = await fetchPage(keyword, region, page);
        
        // If the page returned zero jobs, it means either:
        // a) no jobs left, or
        // b) all jobs on this page were older than 4 days (so we break early)
        if (pageJobs.length === 0) {
          console.log(`[AIDEVJOBS] ${keyword}/${region} page ${page}: no recent jobs (or end of results), stopping pagination`);
          break;
        }

        // Deduplicate against globally seen fingerprints
        const uniqueJobs = pageJobs.filter((job) => {
          if (seenFingerprints.has(job.fingerprint)) return false;
          seenFingerprints.add(job.fingerprint);
          return true;
        });

        if (uniqueJobs.length === 0) {
          // If all jobs on this page were duplicates, we can break because 
          // subsequent pages will likely also be duplicates (assuming sorted by date desc)
          console.log(`[AIDEVJOBS] ${keyword}/${region} page ${page}: all jobs already seen, stopping`);
          break;
        }

        // Remove fingerprint before storing to keep output clean
        for (const j of uniqueJobs) delete j.fingerprint;
        allJobs.push(...uniqueJobs);

        console.log(
          `[AIDEVJOBS] ${keyword}/${region} page ${page}: ${uniqueJobs.length} new recent jobs ` +
          `(${pageJobs.length - uniqueJobs.length} dupes/old/blocked)`
        );
      } catch (err) {
        console.error(`[AIDEVJOBS] ${keyword}/${region} page ${page} failed: ${err.message}`);
        break;
      }
    }
    // Small delay between regions to be polite
    if (regions.length > 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`[AIDEVJOBS] "${keyword}" total: ${allJobs.length} fresh jobs across ${regions.length} regions`);
  return allJobs;
}

module.exports = { fetchAiDevJobs };