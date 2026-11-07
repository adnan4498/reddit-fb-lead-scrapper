const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[YC] company-filter not found, skipping exclusions');
}

const BASE_URL = 'https://api.ycombinator.com/v0.1/companies';
const LIMIT_PER_PAGE = 25;
const BASE_DELAY_MS = 1200;
const MAX_JITTER_MS = 800;
const MAX_PAGES = 2; 

function getDelay() {
  return BASE_DELAY_MS + Math.floor(Math.random() * MAX_JITTER_MS);
}

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeResult(raw, targetBatch) {
  if (!raw || typeof raw !== 'object') return null;
  if (!raw.badges || !Array.isArray(raw.badges)) return null;
  if (!raw.badges.includes('isHiring')) return null;

  // Optional: filter by batch if targetBatch is provided
  if (targetBatch && raw.batch !== targetBatch) return null;

  const companyName = (raw.name || 'Unknown Company').trim();
  const oneLiner = (raw.one_liner || '').trim();
  const title = `Open Positions at ${companyName}`;
  const companyUrl = (raw.url || '').trim();
  const locations = Array.isArray(raw.locations) ? raw.locations : [];
  const region = locations.length > 0 ? locations.join(', ') : 'Remote';
  const slug = raw.slug || '';
  const ycUrl = slug ? `https://www.ycombinator.com/companies/${slug}` : companyUrl;
  const applyUrl = companyUrl || ycUrl;
  const batch = (raw.batch || '').trim();

  const description = [
    oneLiner ? `One-liner: ${oneLiner}` : '',
    batch ? `Batch: ${batch}` : '',
    raw.website ? `Website: ${raw.website}` : '',
  ].filter(Boolean).join('\n');

  const fingerprint = `${title.toLowerCase().trim()}_${companyName.toLowerCase().trim()}`;

  return {
    fingerprint,
    title: title.substring(0, 300),
    company: companyName.substring(0, 200),
    url: ycUrl,
    applyUrl,
    region: region.substring(0, 200),
    platformSource: 'Y Combinator',
    slug: buildSlug(title, companyName),
    status: determineJobStatus(ycUrl),
    scrapedAt: new Date(),
    source: 'ycombinator',
    rawId: raw.id != null ? String(raw.id) : slug,
    location: region,
    countryCode: '',
    description,
    batch,
    salary: { min: null, max: null, currency: null },
    postedAt: null,
    fetchedAt: new Date(),
  };
}

async function fetchPage(page) {
  const url = `${BASE_URL}?page=${page}&limit=${LIMIT_PER_PAGE}&sort=-batch`;

  const response = await fetchWithRetry(
    () =>
      axios.get(url, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
      }),
    `YCombinator/page${page}`
  );

  if (response.status === 404) return { companies: [], totalPages: 0 };

  let companies = [];
  let totalPages = 0;
  const data = response.data;

  if (Array.isArray(data)) {
    companies = data;
  } else if (data && Array.isArray(data.companies)) {
    companies = data.companies;
    totalPages = data.totalPages || 0;
  } else if (data && Array.isArray(data.results)) {
    companies = data.results;
  } else if (data && Array.isArray(data.data)) {
    companies = data.data;
  }

  return { companies, totalPages };
}

async function fetchYCombinatorJobs(
  keyword,
  regions = ['intl'],
  seenFingerprints = new Set()
) {
  const allJobs = [];
  console.log(`[YC] Fetching hiring companies (keyword "${keyword || 'all'}" ignored) – limiting to ${MAX_PAGES} pages for recency`);

  let targetBatch = null;
  let consecutiveEmptyPages = 0;
  const maxConsecutiveEmpty = 3; // stop after 3 pages with no hiring

  for (let page = 1; page <= MAX_PAGES; page++) {
    try {
      const { companies: rawResults, totalPages: pageTotal } = await fetchPage(page);

      if (!Array.isArray(rawResults) || rawResults.length === 0) {
        console.log(`[YC] page ${page}: no results, stopping`);
        break;
      }

      // Determine target batch from first page (most recent batch)
      if (page === 1 && rawResults.length > 0) {
        const firstCompany = rawResults[0];
        if (firstCompany && firstCompany.batch) {
          targetBatch = firstCompany.batch;
          console.log(`[YC] Target batch: ${targetBatch} – only companies from this batch will be included`);
        }
      }

      // Normalize with batch filter
      const hiringCompanies = rawResults
        .map((raw) => normalizeResult(raw, targetBatch))
        .filter((job) => job && job.title && job.company)
        .filter((job) => !shouldExcludeCompany(job.company));

      if (hiringCompanies.length === 0) {
        consecutiveEmptyPages++;
        console.log(`[YC] page ${page}: no hiring from target batch (${consecutiveEmptyPages}/${maxConsecutiveEmpty})`);
        if (consecutiveEmptyPages >= maxConsecutiveEmpty) {
          console.log(`[YC] stopped after ${maxConsecutiveEmpty} pages with no hiring from target batch`);
          break;
        }
        // Continue to next page, but wait less
        if (page < MAX_PAGES) await new Promise(r => setTimeout(r, 500));
        continue;
      }

      consecutiveEmptyPages = 0; // reset

      const uniqueJobs = hiringCompanies.filter((job) => {
        if (seenFingerprints.has(job.fingerprint)) return false;
        seenFingerprints.add(job.fingerprint);
        return true;
      });

      if (uniqueJobs.length > 0) {
        for (const j of uniqueJobs) delete j.fingerprint;
        allJobs.push(...uniqueJobs);
        console.log(
          `[YC] page ${page}: ${uniqueJobs.length} new (${rawResults.length} raw, ${hiringCompanies.length} hiring from ${targetBatch}, ${hiringCompanies.length - uniqueJobs.length} dupes)`
        );
      } else {
        console.log(`[YC] page ${page}: all hiring from target batch are duplicates, continuing`);
      }

      // If we've reached the last page reported by API (unlikely with page limit)
      if (page >= pageTotal) break;

      // Wait before next page
      if (page < MAX_PAGES) {
        const delay = getDelay();
        console.log(`[YC] Waiting ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }

    } catch (err) {
      if (err.response && err.response.status === 429) {
        const retryAfter = err.response.headers['retry-after'];
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
        console.warn(`[YC] Rate limited — waiting ${waitTime / 1000}s`);
        await new Promise(r => setTimeout(r, waitTime));
        continue;
      }
      console.error(`[YC] page ${page} error: ${err.message}`);
      break;
    }
  }

  console.log(`[YC] Total hiring companies fetched: ${allJobs.length} (from batch ${targetBatch || 'unknown'})`);
  return allJobs;
}

module.exports = { fetchYCombinatorJobs };