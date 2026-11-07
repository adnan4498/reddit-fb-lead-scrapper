const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[JOBICY] company-filter not found, skipping exclusions');
}

// Changed from /remote-jobs to /jobs to get all workplace types (physical, hybrid, remote)
const BASE_URL = 'https://jobicy.com/api/v2/jobs';
const MAX_COUNT = 50;

// ---- Freshness filter (1 days) ----
const ONE_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function deriveWorkplaceType(jobTitle, jobDescription) {
  const text = [jobTitle || '', jobDescription || ''].join(' ').toLowerCase();

  const onsiteTerms = /\bon[-]?site\b|in[-]office\b/;
  const hybridTerms = /\bhybrid\b|blended\s*work\b/;
  const remoteTerms = /\bremote\b|work\s*from\s*home\b|wfh\b/;

  const hasOnsite = onsiteTerms.test(text);
  const hasHybrid = hybridTerms.test(text);
  const hasRemote = remoteTerms.test(text);

  if (hasOnsite && !hasRemote) return 'physical';
  if (hasHybrid) return 'hybrid';
  return 'remote'; // default if no keyword found
}

function normalizeResult(raw) {
  const title = (raw.jobTitle || raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.companyName || raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.url || raw.applyUrl || raw.link || '').trim();
  const region = (raw.jobGeo || raw.geo || 'Remote').trim();
  const description = (raw.jobDescription || raw.description || '').trim();

  let postedAt = null;
  if (raw.pubDate) {
    const parsed = new Date(raw.pubDate);
    if (!isNaN(parsed.getTime())) postedAt = parsed;
  }

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region,
    platformSource: 'Jobicy',
    slug: buildSlug(title, company),
    status: determineJobStatus(url),
    scrapedAt: new Date(),
    source: 'jobicy',
    rawId: raw.id != null ? String(raw.id) : url,
    location: region,
    countryCode: '',
    description,
    salary: { min: null, max: null, currency: null },
    workplaceType: deriveWorkplaceType(title, description),
    postedAt,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region) {
  const params = {
    count: MAX_COUNT,
    tag: keyword || undefined,
  };
  if (region && region !== 'intl') {
    params.geo = region;
  }

  const response = await fetchWithRetry(
    () =>
      axios.get(BASE_URL, {
        params,
        timeout: 30000,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
      }),
    `Jobicy/${keyword || 'all'}`
  );

  if (response.status === 404) return [];

  const data = response.data && response.data.jobs;
  if (!Array.isArray(data) || data.length === 0) return [];

  const now = Date.now();

  return data
    .map((raw) => normalizeResult(raw))
    .filter((job) => {
      if (!job.title || !job.company) return false;
      if (shouldExcludeCompany && shouldExcludeCompany(job.company)) return false;

      // ---- 3‑day freshness filter ----
      if (job.postedAt) {
        const age = now - job.postedAt.getTime();
        if (age > ONE_DAYS_MS) {
          return false;
        }
      } else {
        console.warn(`[JOBICY] Job has no posted date: "${job.title}" at ${job.company}`);
      }

      return true;
    });
}

async function fetchJobicyJobs(
  keyword,
  regions = ['intl'],
  seenFingerprints = new Set()
) {
  const allJobs = [];

  const targetRegions = Array.isArray(regions) && regions.length > 0 ? regions : ['intl'];

  for (const region of targetRegions) {
    try {
      const pageJobs = await fetchPage(keyword, region);

      if (pageJobs.length === 0) {
        console.log(`[JOBICY] ${keyword || 'all'}/${region}: no jobs returned`);
        continue;
      }

      const uniqueJobs = pageJobs.filter((job) => {
        if (seenFingerprints.has(job.fingerprint)) return false;
        seenFingerprints.add(job.fingerprint);
        return true;
      });

      for (const j of uniqueJobs) delete j.fingerprint;
      allJobs.push(...uniqueJobs);

      console.log(
        `[JOBICY] ${keyword || 'all'}/${region}: ${uniqueJobs.length} jobs ` +
        `(${pageJobs.length - uniqueJobs.length} dupes/blocked/old)`
      );
    } catch (err) {
      console.error(`[JOBICY] ${keyword || 'all'}/${region} failed: ${err.message}`);
    }
  }

  console.log(`[JOBICY] "${keyword || 'all'}" total: ${allJobs.length} jobs`);
  return allJobs;
}

module.exports = { fetchJobicyJobs };