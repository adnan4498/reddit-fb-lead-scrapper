const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');
const { createRegionSkipTracker } = require('./regionSkip');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[JOBDATALAKE] company-filter not found, skipping exclusions');
}

const API_KEY = process.env.JOBDATALAKE_API_KEY;
const BASE_URL = process.env.JOBDATALAKE_BASE_URL || 'https://api.jobdatalake.com/v1/jobs/';
const MAX_PAGES = 2;
const RESULTS_PER_PAGE = 100;
const ONE_DAYS_MSS = 2 * 24 * 60 * 60 * 1000;

// (Optional) You can re-enable seniority filter if needed
// const DEFAULT_SENIORITY = 'Entry,Mid Level,Senior,Staff,Principal';

// We no longer restrict to fully_remote — fetch all job types.
// const DEFAULT_REMOTE_TYPE = 'fully_remote';

const JOBDATALAKE_REGIONS = ["us", "gb", "de", "fr", "it", "es", "nl", "be", "ch", "at", 
  "ie", "lu", "se", "no", "dk", "fi", "pl", "cz", "ro", "hu", 
  "gr", "pt", "bg", "hr", "cy", "ee", "lv", "lt", "mt", "sk", 
  "si", "is", "li", "sg", "my", "ph", "id", "th", "vn", "ae", 
  "sa", "qa", "kw", "om", "bh", "pk"];

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function parseTimestamp(raw) {
  if (raw == null) return null;
  const ts = typeof raw === 'number' ? raw : Number(raw);
  if (isNaN(ts) || ts <= 0) return null;
  const date = new Date(ts < 1000000000000 ? ts * 1000 : ts);
  return isNaN(date.getTime()) ? null : date;
}

function normalizeResult(raw, region) {
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company_name || raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.url || raw.apply_url || raw.link || '').trim();
  const locationName = (raw.location || raw.region || region || '').trim();
  const countryCode = (raw.country_code || raw.country || region || '').toString().toLowerCase().substring(0, 2);
  const remoteType = (raw.remote_type || '').toLowerCase().trim();

  const postedAt = parseTimestamp(raw.posted_at);
  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region: locationName || region.toUpperCase(),
    platformSource: 'JobDataLake',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'jobdatalake',
    rawId: (raw.job_handle || raw.id || '').toString().trim(),
    location: locationName,
    countryCode,
    description: (raw.description || raw.snippet || raw.summary || '').trim(),
    salary: {
      min: raw.salary_min_usd != null ? Math.round(Number(raw.salary_min_usd)) : null,
      max: raw.salary_max_usd != null ? Math.round(Number(raw.salary_max_usd)) : null,
      currency: 'USD',
    },
    skills: Array.isArray(raw.required_skills) ? raw.required_skills.map(String) : [],
    remoteType,
    postedAt,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region, page) {
  // --------------------------------------------------------------
  // 1. Build a rich query string that covers all your target roles.
  //    You can tweak this list as you like.
  // --------------------------------------------------------------
  const TARGET_ROLES = [
    "React js",
    "Full Stack Developer",
    "Mern Stack Developer",
    "Software Engineer",
    "Next js",
    "Frontend",
    "Web Developer",
    "JavaScript",
  ];

  // Combine them with spaces (API treats space as OR / fuzzy match)
  const queryString = TARGET_ROLES.join(' ');

  const params = {
    query: queryString,               // <-- broad role search
    per_page: RESULTS_PER_PAGE,
    page,
    sort_by: 'posted_at:desc',
    // seniority: DEFAULT_SENIORITY,  // <-- uncomment if you want seniority filter
    // remote_type: DEFAULT_REMOTE_TYPE, // <-- REMOVED to get all work types
  };

  if (region && region !== 'intl') {
    params.country_code = region.toLowerCase();
  }

  const response = await fetchWithRetry(
    () =>
      axios.get(BASE_URL, {
        params,
        headers: {
          'X-API-Key': API_KEY,
          Accept: 'application/json',
        },
        timeout: 30000,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
      }),
    `JobDataLake/${keyword}/page${page}`
  );

  if (response.status === 404) return [];

  const rawData = response.data && (response.data.data || response.data.jobs || response.data.results);
  if (!Array.isArray(rawData) || rawData.length === 0) return [];

  const now = Date.now();
  const normalized = rawData
    .map((raw) => normalizeResult(raw, region))
    .filter((job) => {
      if (!job.title || !job.company) return false;
      if (shouldExcludeCompany && shouldExcludeCompany(job.company)) return false;

      if (job.postedAt) {
        const age = now - job.postedAt.getTime();
        if (age > ONE_DAYS_MSS) return false;
      }

      return true;
    });

  return normalized;
}

async function fetchJobDataLakeJobs(
  keyword,
  regions = JOBDATALAKE_REGIONS,
  seenFingerprints = new Set()
) {
  if (!API_KEY) {
    console.error('[JOBDATALAKE] JOBDATALAKE_API_KEY is not configured. Skipping.');
    return [];
  }

  const targetRegions = Array.isArray(regions) && regions.length > 0 ? regions : ['intl'];
  const allJobs = [];
  const skipTracker = createRegionSkipTracker(3);

  for (const region of targetRegions) {
    let regionHadNewJobs = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const pageJobs = await fetchPage(keyword, region, page);

        if (pageJobs.length === 0) {
          console.log(
            `[JOBDATALAKE] ${keyword}/${region} page ${page}: no recent jobs, stopping pagination`
          );
          break;
        }

        const uniqueJobs = pageJobs.filter((job) => {
          if (seenFingerprints.has(job.fingerprint)) return false;
          seenFingerprints.add(job.fingerprint);
          return true;
        });

        if (uniqueJobs.length === 0) {
          console.log(
            `[JOBDATALAKE] ${keyword}/${region} page ${page}: all duplicates, breaking`
          );
          break;
        }

        for (const j of uniqueJobs) delete j.fingerprint;
        allJobs.push(...uniqueJobs);
        regionHadNewJobs = true;

        console.log(
          `[JOBDATALAKE] ${keyword}/${region} page ${page}: ${uniqueJobs.length} new jobs ` +
          `(${pageJobs.length - uniqueJobs.length} dupes/old/blocked)`
        );
      } catch (err) {
        console.error(
          `[JOBDATALAKE] ${keyword}/${region} page ${page} failed: ${err.message}`
        );
        break;
      }
    }

    if (skipTracker.onRegionDone(regionHadNewJobs)) break;

    if (targetRegions.length > 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(
    `[JOBDATALAKE] "${keyword}" total: ${allJobs.length} jobs across ${targetRegions.length} regions`
  );
  return allJobs;
}

module.exports = { fetchJobDataLakeJobs };