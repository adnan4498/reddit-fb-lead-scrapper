const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[ARBEITNOW] company-filter not found, skipping exclusions');
}

const BASE_URL = 'https://www.arbeitnow.com/api/job-board-api';
const MAX_PAGES = 2;

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeResult(raw, region) {
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company_name || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.url || '').trim();
  const locationName = (raw.location || '').trim();

  let postedAt = null;
  if (raw.created_at != null) {
    const ts = typeof raw.created_at === 'number' ? raw.created_at : parseInt(raw.created_at, 10);
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
    platformSource: 'arbeitnow',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'arbeitnow',
    rawId: raw.slug || url,
    location: locationName,
    countryCode: region.toLowerCase(),
    description: (raw.description || '').trim(),
    salary: { min: null, max: null, currency: null },
    postedAt,
    fetchedAt: new Date(),
  };
}

async function fetchPage(page) {
  const response = await fetchWithRetry(
    () =>
      axios.get(BASE_URL, {
        params: { page },
        timeout: 30000,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
      }),
    `Arbeitnow/page${page}`
  );

  if (response.status === 404) return { jobs: [], hasMore: false };

  const data = response.data && response.data.data;
  if (!Array.isArray(data) || data.length === 0) return { jobs: [], hasMore: false };

  return {
    jobs: data,
    hasMore: response.data.links && response.data.links.next != null,
  };
}

async function fetchArbeitnowJobs(
  keyword,
  regions = ['intl'],
  seenFingerprints = new Set()
) {
  const allJobs = [];
  const defaultRegion = (regions[0] || 'intl').toLowerCase();

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const { jobs, hasMore } = await fetchPage(page);

      if (jobs.length === 0) break;

      const normalizedJobs = jobs
        .map((raw) => normalizeResult(raw, defaultRegion))
        .filter((job) => {
          if (!job.title || !job.company) return false;
          if (shouldExcludeCompany && shouldExcludeCompany(job.company)) return false;
          return true;
        });

      const uniqueJobs = normalizedJobs.filter((job) => {
        if (seenFingerprints.has(job.fingerprint)) return false;
        seenFingerprints.add(job.fingerprint);
        return true;
      });

      if (uniqueJobs.length === 0 && !hasMore) break;

      for (const j of uniqueJobs) delete j.fingerprint;
      allJobs.push(...uniqueJobs);
      console.log(`[ARBEITNOW] page ${page}: ${uniqueJobs.length} new jobs (${normalizedJobs.length - uniqueJobs.length} dupes/blocked)`);

      if (!hasMore) break;
      if (page < MAX_PAGES) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      console.error(`[ARBEITNOW] page ${page} failed: ${err.message}`);
      break;
    }
  }

  console.log(`[ARBEITNOW] "${keyword}" total: ${allJobs.length} jobs`);
  return allJobs;
}

module.exports = { fetchArbeitnowJobs };
