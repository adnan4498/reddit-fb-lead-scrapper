const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');

const SERP_API_KEY = process.env.SERP_API_KEY;
const BASE_URL = 'https://serpapi.com/search.json';

const MAX_PAGES = 2;
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
  const company = (raw.company_name || raw.companyName || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.related_links && raw.related_links[0] && raw.related_links[0].link
    ? raw.related_links[0].link
    : raw.apply_link || raw.link || '').trim();
  const locationName = (raw.location || '').trim();

  const postedAt = raw.detected_extensions
    && raw.detected_extensions.posted_at
    ? new Date(raw.detected_extensions.posted_at)
    : raw.date ? new Date(raw.date) : null;

  if (postedAt && (Date.now() - postedAt.getTime()) > ONE_DAYS_MS) {
    return null;
  }

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region: locationName || region.toUpperCase(),
    platformSource: 'serpapi',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'serpapi',
    rawId: url,
    location: locationName,
    countryCode: region.toLowerCase(),
    description: (raw.description || raw.snippet || '').trim(),
    salary: { min: null, max: null, currency: null },
    postedAt,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region, page) {
  const startIndex = (page - 1) * 10;

  const response = await fetchWithRetry(
    () =>
      axios.get(BASE_URL, {
        params: {
          engine: 'google_jobs',
          q: `${keyword}`,
          gl: region,
          api_key: SERP_API_KEY,
          start: startIndex,
        },
        timeout: 30000,
      }),
    `SERPAPI/${region}/${keyword}/page${page}`
  );

  const results = response.data && response.data.jobs_results;
  if (!Array.isArray(results) || results.length === 0) return [];

  return results
    .map((raw) => normalizeResult(raw, region))
    .filter(Boolean);
}

async function fetchSerpApiGoogleJobs(keyword, regions = ['us'], seenFingerprints = new Set()) {
  const allJobs = [];

  for (const region of regions) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const pageJobs = await fetchPage(keyword, region, page);
        if (pageJobs.length === 0) break;

        const uniquePageJobs = pageJobs.filter(job => {
          if (!job.title || !job.company) return false;
          if (seenFingerprints.has(job.fingerprint)) return false;
          seenFingerprints.add(job.fingerprint);
          return true;
        });
        if (uniquePageJobs.length === 0) {
          console.log(`[SERPAPI] ${region}/${keyword} page ${page}: all duplicates, breaking`);
          break;
        }

        for (const j of uniquePageJobs) delete j.fingerprint;
        allJobs.push(...uniquePageJobs);
        console.log(`[SERPAPI] ${region}/${keyword} page ${page}: ${uniquePageJobs.length} jobs (${pageJobs.length - uniquePageJobs.length} dupes)`);
      } catch (err) {
        console.error(`[SERPAPI] ${region}/${keyword} page ${page} failed: ${err.message}`);
      }
    }
    if (regions.length > 1) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`[SERPAPI] ${keyword} total: ${allJobs.length} jobs across ${regions.length} regions`);
  return allJobs;
}

module.exports = { fetchSerpApiGoogleJobs };
