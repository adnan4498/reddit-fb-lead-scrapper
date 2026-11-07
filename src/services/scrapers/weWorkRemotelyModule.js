const Parser = require('rss-parser');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[WWR] company-filter not found, skipping exclusions');
}

const FEED_URL = 'https://weworkremotely.com/remote-jobs.rss';
const ONE_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

const parser = new Parser({
  timeout: 30000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
});

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

function parseTitle(item) {
  const rawTitle = (item.title || '').trim();
  if (!rawTitle) return { company: 'Unknown Company', title: 'Unknown Position' };

  const colonIdx = rawTitle.indexOf(':');
  if (colonIdx > 0) {
    return {
      company: rawTitle.substring(0, colonIdx).trim().substring(0, 200),
      title: rawTitle.substring(colonIdx + 1).trim().substring(0, 300),
    };
  }

  return { company: 'Unknown Company', title: rawTitle.substring(0, 300) };
}

function normalizeResult(raw) {
  if (!raw) return null;

  const { company, title } = parseTitle(raw);
  const applyUrl = (raw.link || '').trim();
  const description = stripHtml(raw.content || raw['content:encoded'] || raw.contentSnippet || raw.summary || '');
  const postedAt = raw.pubDate ? new Date(raw.pubDate) : null;

  if (!title || !company || !applyUrl) return null;

  const now = Date.now();
  if (postedAt && (now - postedAt.getTime()) > ONE_DAYS_MS) {
    return null;
  }

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    applyUrl,
    url: applyUrl,
    description,
    postedAt,
    slug: buildSlug(title, company),
    region: 'Remote',
    platformSource: 'We Work Remotely',
    source: 'weworkremotely',
    status: determineJobStatus(applyUrl),
    scrapedAt: new Date(),
    fetchedAt: new Date(),
  };
}

function matchesKeyword(job, keyword) {
  if (!keyword) return true;
  const kw = keyword.toLowerCase().trim();
  const haystack = [job.title, job.company, job.description].join(' ').toLowerCase();
  return haystack.includes(kw);
}

async function fetchWeWorkRemotelyJobs(keyword, regions, seenFingerprints) {
  const allJobs = [];

  try {
    const feed = await fetchWithRetry(
      () => parser.parseURL(FEED_URL),
      'WeWorkRemotely'
    );

    if (!feed || !Array.isArray(feed.items) || feed.items.length === 0) {
      console.log('[WWR] No items in RSS feed');
      return [];
    }

    console.log(`[WWR] Fetched ${feed.items.length} raw items from RSS`);

    const jobs = feed.items
      .map((raw) => normalizeResult(raw))
      .filter((job) => job && job.title && job.company && job.applyUrl)
      .filter((job) => !shouldExcludeCompany(job.company))
      .filter((job) => matchesKeyword(job, keyword));

    const uniqueJobs = jobs.filter((job) => {
      if (seenFingerprints.has(job.fingerprint)) return false;
      seenFingerprints.add(job.fingerprint);
      return true;
    });

    for (const j of uniqueJobs) delete j.fingerprint;
    allJobs.push(...uniqueJobs);

    console.log(
      `[WWR] "${keyword || 'all'}": ${uniqueJobs.length} jobs ` +
      `(${feed.items.length} raw, ${jobs.length} matched, ${jobs.length - uniqueJobs.length} dupes)`
    );
  } catch (err) {
    console.error(`[WWR] "${keyword}" failed: ${err.message}`);
    return [];
  }

  return allJobs;
}

module.exports = { fetchWeWorkRemotelyJobs };
