const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');
const { createRegionSkipTracker } = require('./regionSkip');

// Import company filter with fallback
let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[THEIRSTACK] company-filter not found, skipping exclusions');
}

const THEIRSTACK_API_KEY = process.env.THEIRSTACK_API_KEY;
const BASE_URL = 'https://api.theirstack.com/v1/jobs/search';

// Free tier allows max 25 per page; fetch up to 5 pages to get more results
const MAX_PAGES = 2;
const PAGE_SIZE = 25;

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeResult(raw, region) {
  const title = (raw.job_title || raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company_name || raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.url || raw.job_url || '').trim();
  const locationName = (raw.location || raw.city || '').trim();

  let postedAt = raw.date_posted || raw.created_at || raw.published_at || null;
  if (postedAt) {
    postedAt = new Date(postedAt);
    if (isNaN(postedAt.getTime())) postedAt = null;
  }

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region: locationName || region.toUpperCase(),
    platformSource: 'theirstack',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'theirstack',
    rawId: String(raw.id || raw.job_id || ''),
    location: locationName,
    countryCode: region.toLowerCase(),
    description: (raw.description || raw.job_description || '').trim(),
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
  const payload = {
    posted_at_max_age_days: 3,                    // mandatory filter
    job_title_or: [keyword],                      // match title
    job_description_contains_or: [keyword],      // whole-word match in description (correct field)
    job_country_code_or: [region.toUpperCase()], // ISO2 country code
    limit: PAGE_SIZE,                            // 25 max for free tier
    page: page,
  };

  try {
    const response = await axios.post(BASE_URL, payload, {
      headers: {
        Authorization: `Bearer ${THEIRSTACK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    const items = response.data && response.data.data;
    if (!Array.isArray(items) || items.length === 0) return [];

    return items
      .map((raw) => normalizeResult(raw, region))
      .filter((job) => {
        if (shouldExcludeCompany && shouldExcludeCompany(job.company)) return false;
        return job;
      });
  } catch (err) {
    if (err.response) {
      console.error(
        `[THEIRSTACK] ${region}/${keyword} page ${page} failed (${err.response.status}):`,
        JSON.stringify(err.response.data, null, 2).slice(0, 1000)
      );
    } else {
      console.error(`[THEIRSTACK] ${region}/${keyword} page ${page} failed: ${err.message}`);
    }
    throw err;
  }
}

async function fetchTheirStackJobs(
  keyword,
regions = [
  "US", "GB", "DE", "FR", "IT", "ES", "NL", "BE", "CH", "AT", 
  "IE", "LU", "SE", "NO", "DK", "FI", "PL", "CZ", "RO", "HU", 
  "GR", "PT", "BG", "HR", "CY", "EE", "LV", "LT", "MT", "SK", 
  "SI", "IS", "LI", "SG", "MY", "PH", "ID", "TH", "VN", "AE", 
  "SA", "QA", "KW", "OM", "BH", "PK"
],

  // regions = ['FR'],
  seenFingerprints = new Set()
) {
  const allJobs = [];
  const skipTracker = createRegionSkipTracker(3);

  for (const region of regions) {
    let regionHadNewJobs = false;
    let page = 1;
    let hasMore = true;

    while (hasMore && page <= MAX_PAGES) {
      try {
        const pageJobs = await fetchWithRetry(
          () => fetchPage(keyword, region, page),
          `TheirStack/${region}/${keyword}/page${page}`
        );

        if (pageJobs.length === 0) {
          break;
        }

        const uniqueJobs = pageJobs.filter((job) => {
          if (!job.title || !job.company) return false;
          if (seenFingerprints.has(job.fingerprint)) return false;
          seenFingerprints.add(job.fingerprint);
          return true;
        });

        if (uniqueJobs.length === 0) {
          console.log(`[THEIRSTACK] ${region}/${keyword} page ${page}: all duplicates, stopping`);
          break;
        }

        for (const j of uniqueJobs) delete j.fingerprint;
        allJobs.push(...uniqueJobs);
        regionHadNewJobs = true;
        console.log(`[THEIRSTACK] ${region}/${keyword} page ${page}: ${uniqueJobs.length} new jobs`);

        if (pageJobs.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          page++;
          await new Promise((r) => setTimeout(r, 200));
        }
      } catch (err) {
        console.error(`[THEIRSTACK] ${region}/${keyword} page ${page} failed after retries: ${err.message}`);
        break;
      }
    }

    if (skipTracker.onRegionDone(regionHadNewJobs)) break;
  }

  console.log(`[THEIRSTACK] ${keyword} total: ${allJobs.length} jobs across ${regions.length} regions`);
  return allJobs;
}

module.exports = { fetchTheirStackJobs };