const axios = require('axios');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[REMOTIVE] company-filter not found, skipping exclusions');
}

const BASE_URL = 'https://remotive.com/api/remote-jobs';
const ONE_DAYS_MS = 2 * 24 * 60 * 60 * 1000; // 1 days (as you set)

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

function normalizeResult(raw) {
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company_name || raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.url || '').trim();
  const region = (raw.candidate_required_location || 'Remote').trim();
  const description = stripHtml(raw.description || '');

  let postedAt = null;
  if (raw.publication_date) {
    const parsed = new Date(raw.publication_date);
    if (!isNaN(parsed.getTime())) postedAt = parsed;
  }

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region,
    platformSource: 'Remotive',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'remotive',
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

/**
 * Match a job against a single keyword (AND of words)
 * Example: "react developer" → requires both "react" AND "developer" to appear.
 */
function matchesKeywordAnd(job, keyword) {
  if (!keyword) return true;
  const words = keyword.toLowerCase().trim().split(/\s+/).filter(w => w.length > 1);
  if (words.length === 0) return true;
  const titleLower = job.title.toLowerCase();
  const descLower = job.description.toLowerCase();
  return words.every(word => titleLower.includes(word) || descLower.includes(word));
}

/**
 * Match a job against a list of keywords (OR of AND matches)
 * Returns true if ANY keyword matches via AND-word logic.
 */
function matchesAnyKeyword(job, keywords) {
  if (!keywords || keywords.length === 0) return true;
  return keywords.some(kw => matchesKeywordAnd(job, kw));
}

/**
 * Fetch all jobs once, then filter locally.
 * @param {string|string[]} keywords - single keyword or array
 * @param {number} limit - API limit (default 100)
 */
async function fetchRemotiveJobs(keywords = [], limit = 100) {
  const keywordArray = Array.isArray(keywords) ? keywords : [keywords];
  const hasKeywords = keywordArray.some(k => k && k.trim().length > 0);

  try {
    const response = await axios.get(BASE_URL, {
      params: { limit },
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const rawJobs = response.data?.jobs || [];
    if (rawJobs.length === 0) {
      console.log('[REMOTIVE] No jobs returned from API');
      return [];
    }

    console.log(`[REMOTIVE] Fetched ${rawJobs.length} raw jobs`);

    const now = Date.now();
    const processed = rawJobs
      .map(normalizeResult)
      .filter(job => job.title && job.company && job.url)
      .filter(job => !shouldExcludeCompany(job.company))
      .filter(job => {
        if (hasKeywords) {
          return matchesAnyKeyword(job, keywordArray);
        }
        return true;
      })
      .filter(job => {
        if (job.postedAt) {
          return (now - job.postedAt.getTime()) <= ONE_DAYS_MS;
        }
        console.warn(`[REMOTIVE] No date for: ${job.title} at ${job.company}`);
        return true;
      });

    // Deduplicate
    const seen = new Set();
    const unique = processed.filter(job => {
      const fp = job.fingerprint;
      if (seen.has(fp)) return false;
      seen.add(fp);
      return true;
    });

    for (const j of unique) delete j.fingerprint;

    console.log(
      `[REMOTIVE] Keywords: ${keywordArray.join(', ') || 'all'} → ` +
      `${unique.length} jobs (raw: ${rawJobs.length}, matched: ${processed.length})`
    );

    return unique;
  } catch (err) {
    console.error(`[REMOTIVE] Request failed: ${err.message}`);
    return [];
  }
}

module.exports = { fetchRemotiveJobs };