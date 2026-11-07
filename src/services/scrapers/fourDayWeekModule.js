const axios = require('axios');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[4DWW] company-filter not found, skipping exclusions');
}

const BASE_URL = 'https://4dayweek.io/api/v2/jobs';
const MAX_PAGES = 2;
const LIMIT_PER_PAGE = 100;

// ---- Local exclusion list for 4dayweek only ----
const LOCAL_EXCLUDED_COMPANIES = [
  'Canva',
  'Experian',
  'ServiceNow',
  'PhantomBuster',
  // Add more companies as needed
];

// ---- Freshness filter (2 days) ----
const MAX_AGE_DAYS = 2;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// ---- Safe delays ----
const BASE_DELAY_MS = 1500;
const MAX_JITTER_MS = 1000;

function getDelay() {
  return BASE_DELAY_MS + Math.floor(Math.random() * MAX_JITTER_MS);
}

// ---- Helper: clean URL by removing trailing punctuation ----
function cleanUrl(url) {
  if (!url) return url;
  return url.replace(/[.,;:!?)\]}'\"]+$/, '').trim();
}

// ---- Helper: extract external apply URL from description, or build Google search ----
function buildApplyUrl(description, companyName, jobTitle, companyWebsite) {
  // 1. Try to extract a direct link from description
  if (description) {
    const atsPatterns = [
      /https?:\/\/[^\s<>"']*(greenhouse\.io|lever\.co|apply\.workable\.com|jobs\.ashbyhq\.com|recruiter\.com|careers\.)\S*/gi,
      /https?:\/\/[^\s<>"']*(apply|careers|jobs)\.[^\s<>"']*/gi,
      /https?:\/\/[^\s<>"']*(company|employer|candidate)[^\s<>"']*\.(com|io|org)\/[^\s<>"']*/gi,
    ];
    for (const pattern of atsPatterns) {
      const matches = description.match(pattern);
      if (matches) {
        const external = matches.find(u => !u.includes('4dayweek.io'));
        if (external) return cleanUrl(external);
      }
    }

    const allUrls = description.match(/https?:\/\/[^\s<>"']+/g);
    if (allUrls) {
      const external = allUrls.find(u => !u.includes('4dayweek.io'));
      if (external) return cleanUrl(external);
    }
  }

  // 2. If no link found, build a Google search URL
  const query = `${companyName} ${jobTitle} careers apply`.trim();
  const encoded = encodeURIComponent(query);
  return `https://www.google.com/search?q=${encoded}`;
}

// ---- other helper functions ----
function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeWorkArrangement(raw) {
  if (!raw) return 'remote';
  const v = String(raw).toLowerCase().trim();
  if (v === 'onsite' || v === 'on_site') return 'physical';
  if (v === 'hybrid') return 'hybrid';
  if (v === 'remote') return 'remote';
  return 'remote';
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company?.name || raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.url || (raw.slug ? `https://4dayweek.io/jobs/${raw.slug}` : '')).trim();
  const region = (raw.country || (raw.company?.country) || 'Remote').trim();
  const description = (raw.description || '').trim();
  const companyWebsite = raw.company?.website || null;

  let postedAt = null;
  if (raw.posted_at) {
    const parsed = new Date(raw.posted_at);
    if (!isNaN(parsed.getTime())) postedAt = parsed;
  }

  const applyUrl = buildApplyUrl(description, company, title, companyWebsite);

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    applyUrl,
    region,
    platformSource: '4dayweek.io',
    slug: buildSlug(title, company),
    status: determineJobStatus(url),
    scrapedAt: new Date(),
    source: 'fourdayweek',
    rawId: raw.id != null ? String(raw.id) : url,
    location: region,
    countryCode: '',
    description,
    salary: { min: null, max: null, currency: null },
    workplaceType: normalizeWorkArrangement(raw.work_arrangement),
    postedAt,
    fetchedAt: new Date(),
  };
}

// ---- fetchPage with local company exclusion ----
async function fetchPage(keyword, page) {
  try {
    const response = await axios.get(BASE_URL, {
      params: {
        q: keyword,
        posted_after: MAX_AGE_DAYS,
        limit: LIMIT_PER_PAGE,
        page,
      },
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    });

    if (response.status === 404) return [];

    let rawJobs = [];
    const data = response.data;
    if (data) {
      if (Array.isArray(data)) rawJobs = data;
      else if (Array.isArray(data.data)) rawJobs = data.data;
      else if (Array.isArray(data.jobs)) rawJobs = data.jobs;
      else if (Array.isArray(data.results)) rawJobs = data.results;
    }

    if (!Array.isArray(rawJobs) || rawJobs.length === 0) return [];

    const now = Date.now();
    const jobs = rawJobs
      .map(raw => normalizeResult(raw))
      .filter(job => job && job.title && job.company && job.url)
      // ---- Global exclusion ----
      .filter(job => !shouldExcludeCompany(job.company))
      // ---- Local exclusion for 4dayweek ----
      .filter(job => !LOCAL_EXCLUDED_COMPANIES.some(name =>
        job.company.toLowerCase().includes(name.toLowerCase())
      ))
      // ---- Freshness ----
      .filter(job => {
        if (job.postedAt) {
          return (now - job.postedAt.getTime()) <= MAX_AGE_MS;
        }
        return true;
      });

    return jobs;
  } catch (err) {
    throw err;
  }
}

// ---- fetchFourDayWeekJobs (unchanged) ----
async function fetchFourDayWeekJobs(
  keyword,
  regions = ['intl'],
  seenFingerprints = new Set()
) {
  const allJobs = [];
  const targetRegions = Array.isArray(regions) && regions.length > 0 ? regions : ['intl'];

  for (const region of targetRegions) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          const pageJobs = await fetchPage(keyword, page);
          if (pageJobs.length === 0) {
            console.log(`[4DWW] "${keyword}" page ${page}: no results, stopping`);
            break;
          }

          const uniqueJobs = pageJobs.filter(job => {
            if (seenFingerprints.has(job.fingerprint)) return false;
            seenFingerprints.add(job.fingerprint);
            return true;
          });

          if (uniqueJobs.length === 0) {
            console.log(`[4DWW] "${keyword}" page ${page}: all duplicates, breaking`);
            break;
          }

          for (const j of uniqueJobs) delete j.fingerprint;
          allJobs.push(...uniqueJobs);

          console.log(
            `[4DWW] "${keyword}" page ${page}: ${uniqueJobs.length} jobs ` +
            `(${pageJobs.length} fresh, ${pageJobs.length - uniqueJobs.length} dupes)`
          );

          if (pageJobs.length < LIMIT_PER_PAGE) {
            console.log(`[4DWW] "${keyword}" page ${page}: last page (< ${LIMIT_PER_PAGE} results)`);
            break;
          }

          const delay = getDelay();
          console.log(`[4DWW] Waiting ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));

          break; // success
        } catch (err) {
          if (err.response && err.response.status === 429) {
            const retryAfter = err.response.headers['retry-after'];
            const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
            console.warn(`[4DWW] Rate limited – waiting ${waitTime/1000}s (attempt ${retryCount+1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, waitTime));
            retryCount++;
            continue;
          }
          console.error(`[4DWW] "${keyword}" page ${page} error: ${err.message}`);
          break;
        }
      }

      if (retryCount === maxRetries) {
        console.log(`[4DWW] "${keyword}" page ${page}: too many retries, stopping.`);
        break;
      }
    }
  }

  console.log(`[4DWW] "${keyword}" total: ${allJobs.length} jobs`);
  return allJobs;
}

module.exports = { fetchFourDayWeekJobs };