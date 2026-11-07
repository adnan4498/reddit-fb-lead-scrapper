const axios = require('axios');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[REMOTEOK] company-filter not found, skipping exclusions');
}

const BASE_URL = 'https://remoteok.com/api';
const ONE_DAYS_MS = 2 * 24 * 60 * 60 * 1000; // 3 days

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

function normalizeResult(raw) {
  const title = (raw.position || raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.url || raw.apply_url || '').trim();
  const location = (raw.location || 'Remote').trim();
  const description = stripHtml(raw.description || '');
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : [];

  let postedAt = null;
  if (raw.date) {
    const parsed = new Date(raw.date);
    if (!isNaN(parsed.getTime())) postedAt = parsed;
  }

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region: location,
    platformSource: 'RemoteOK',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'remoteok',
    rawId: raw.id != null ? String(raw.id) : url,
    location,
    countryCode: '',
    description,
    tags,
    salary: { min: null, max: null, currency: null },
    workplaceType: 'remote',
    postedAt,
    fetchedAt: new Date(),
  };
}

function matchesKeyword(job, keyword) {
  if (!keyword) return true;
  const kw = keyword.toLowerCase().trim();
  const titleLower = job.title.toLowerCase();
  if (titleLower.includes(kw)) return true;
  if (Array.isArray(job.tags)) {
    return job.tags.some((t) => String(t).toLowerCase().includes(kw));
  }
  return false;
}

async function fetchRemoteokJobs(
  keyword,
  regions = ['intl'],
  seenFingerprints = new Set()
) {
  const allJobs = [];

  try {
    const response = await axios.get(BASE_URL, {
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      validateStatus: (status) => status >= 200 && status < 300,
    });

    const rawData = response.data;
    if (!Array.isArray(rawData) || rawData.length <= 1) {
      console.log('[REMOTEOK] Empty or metadata-only response');
      return [];
    }

    const now = Date.now();

    const jobs = rawData
      .slice(1)
      .filter((raw) => raw && typeof raw === 'object' && !raw.legal)
      .map((raw) => normalizeResult(raw))
      .filter((job) => job.title && job.company && job.url && matchesKeyword(job, keyword))
      .filter((job) => !(shouldExcludeCompany && shouldExcludeCompany(job.company)))
      // ---- 3‑day freshness filter ----
      .filter((job) => {
        if (job.postedAt) {
          const age = now - job.postedAt.getTime();
          return age <= ONE_DAYS_MS; // keep only if within 3 days
        }
        // If no date, keep it (but warn)
        console.warn(`[REMOTEOK] Job has no posted date: "${job.title}" at ${job.company}`);
        return true;
      });

    const uniqueJobs = jobs.filter((job) => {
      if (seenFingerprints.has(job.fingerprint)) return false;
      seenFingerprints.add(job.fingerprint);
      return true;
    });

    for (const j of uniqueJobs) delete j.fingerprint;
    allJobs.push(...uniqueJobs);

    console.log(
      `[REMOTEOK] "${keyword || 'all'}" total: ${uniqueJobs.length} jobs (after 3‑day filter) ` +
      `(${rawData.length - 1} raw, ${jobs.length} matched & fresh, ${jobs.length - uniqueJobs.length} dupe-skipped)`
    );
  } catch (err) {
    if (err.response && err.response.status === 403) {
      console.error('[REMOTEOK] 403 Forbidden — add/update User-Agent header');
    } else {
      console.error(`[REMOTEOK] Request failed: ${err.message}`);
    }
    return [];
  }

  return allJobs;
}

module.exports = { fetchRemoteokJobs };