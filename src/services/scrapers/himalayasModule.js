const axios = require('axios');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[HIMALAYAS] company-filter not found, skipping exclusions');
}

const BASE_URL = 'https://himalayas.app/jobs/api/search';
const MAX_PAGES = 2;
const MAX_AGE_DAYS = 2;
const MAX_AGE_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// ---- Slower, respectful delays ----
const BASE_DELAY_MS = 1500;           // 1.5s minimum
const MAX_JITTER_MS = 1000;           // up to +1s extra => 1.5–2.5s

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

function stripHtml(str) {
  if (!str) return '';
  return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .trim();
}

function deriveWorkplaceType(title, description) {
  const text = [title || '', description || ''].join(' ').toLowerCase();
  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\bon[-]?site\b|\bin[-]office\b/.test(text)) return 'physical';
  return 'remote';
}

function parseDate(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    const ts = raw < 1000000000000 ? raw * 1000 : raw;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'string') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.companyName || raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.applicationLink || raw.url || '').trim();
  const description = stripHtml(raw.description || '');
  const region = Array.isArray(raw.locationRestrictions) && raw.locationRestrictions.length > 0
    ? raw.locationRestrictions.join(', ').trim()
    : 'Remote';
  const postedAt = parseDate(raw.pubDate);
  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region,
    platformSource: 'Himalayas',
    slug: buildSlug(title, company),
    status: determineJobStatus(url),
    scrapedAt: new Date(),
    source: 'himalayas',
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

async function fetchPage(keyword, page, region = 'intl') {
  const params = { q: keyword, page };
  if (region && region !== 'intl') {
    // params.location = region; // uncomment if API supports it
  }

  const response = await axios.get(BASE_URL, {
    params,
    timeout: 30000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
    validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
  });

  if (response.status === 404) {
    console.log(`[HIMALAYAS] 404 for ${keyword} page ${page} – no results`);
    return [];
  }

  // ---- Robust response parsing ----
  let rawJobs = [];
  const data = response.data;
  if (data) {
    if (Array.isArray(data)) {
      rawJobs = data;
    } else if (Array.isArray(data.jobs)) {
      rawJobs = data.jobs;
    } else if (Array.isArray(data.results)) {
      rawJobs = data.results;
    } else if (Array.isArray(data.data)) {
      rawJobs = data.data;
    } else if (data.jobs && typeof data.jobs === 'object') {
      // Sometimes jobs might be an object with keys like 'items' – we can try to extract
      rawJobs = Object.values(data.jobs).flat().filter(item => item && typeof item === 'object');
    }
  }

  if (!Array.isArray(rawJobs) || rawJobs.length === 0) {
    console.log(`[HIMALAYAS] ${keyword} page ${page}: no jobs array found in response`);
    return [];
  }

  const now = Date.now();
  const jobs = rawJobs
    .map(raw => normalizeResult(raw))
    .filter(job => job && job.title && job.company && job.url)
    .filter(job => !shouldExcludeCompany(job.company))
    .filter(job => {
      if (job.postedAt) {
        return (now - job.postedAt.getTime()) <= MAX_AGE_MS;
      }
      return true;
    });

  return jobs;
}

async function fetchHimalayasJobs(
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
          const pageJobs = await fetchPage(keyword, page, region);
          if (pageJobs.length === 0) {
            console.log(`[HIMALAYAS] "${keyword}" ${region} page ${page}: no results, stopping`);
            break; // no more jobs
          }

          const uniqueJobs = pageJobs.filter(job => {
            if (seenFingerprints.has(job.fingerprint)) return false;
            seenFingerprints.add(job.fingerprint);
            return true;
          });

          if (uniqueJobs.length === 0) {
            console.log(`[HIMALAYAS] "${keyword}" ${region} page ${page}: all duplicates, breaking`);
            break;
          }

          for (const j of uniqueJobs) delete j.fingerprint;
          allJobs.push(...uniqueJobs);

          console.log(
            `[HIMALAYAS] "${keyword}" ${region} page ${page}: ${uniqueJobs.length} jobs ` +
            `(${pageJobs.length} fresh, ${pageJobs.length - uniqueJobs.length} dupes)`
          );

          if (pageJobs.length < 20) {
            console.log(`[HIMALAYAS] "${keyword}" ${region} page ${page}: last page (< 20 results)`);
            break;
          }

          // ---- Delay before next page ----
          const delay = getDelay();
          console.log(`[HIMALAYAS] Waiting ${delay}ms...`);
          await new Promise(r => setTimeout(r, delay));

          break; // success – exit retry loop
        } catch (err) {
          if (err.response && err.response.status === 429) {
            const retryAfter = err.response.headers['retry-after'];
            const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
            console.warn(`[HIMALAYAS] Rate limited – waiting ${waitTime/1000}s (attempt ${retryCount+1}/${maxRetries})`);
            await new Promise(r => setTimeout(r, waitTime));
            retryCount++;
            continue;
          }
          console.error(`[HIMALAYAS] "${keyword}" ${region} page ${page} error: ${err.message}`);
          break;
        }
      }

      // If we exhausted retries, break pagination
      if (retryCount === maxRetries) {
        console.log(`[HIMALAYAS] "${keyword}" ${region} page ${page}: too many retries, stopping.`);
        break;
      }
    }
  }

  console.log(`[HIMALAYAS] "${keyword}" total: ${allJobs.length} jobs`);
  return allJobs;
}

module.exports = { fetchHimalayasJobs };