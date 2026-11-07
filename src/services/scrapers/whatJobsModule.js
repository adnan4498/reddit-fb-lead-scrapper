const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');
const { createRegionSkipTracker } = require('./regionSkip');

let shouldExcludeCompany;
try {
  shouldExcludeCompany = require('../../../scripts/lib/company-filter').shouldExcludeCompany;
} catch (e) {
  shouldExcludeCompany = () => false;
  console.warn('[WHATJOBS] company-filter not found, skipping exclusions');
}

const BASE_URL = 'https://us.whatjobs.com/api/v1/jobs';
const MAX_PAGES = 2;

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function parseSalary(rawSalary) {
  if (!rawSalary) return { min: null, max: null, currency: null };
  const str = String(rawSalary).trim();
  const parts = str.split('-').map((s) => parseFloat(s.replace(/[^0-9.]/g, '')));
  const min = parts.length >= 1 && !isNaN(parts[0]) ? parts[0] : null;
  const max = parts.length === 2 && !isNaN(parts[1]) ? parts[1] : null;
  let currency = null;
  if (str.includes('$') || str.toUpperCase().includes('USD')) currency = 'USD';
  else if (str.includes('£')) currency = 'GBP';
  else if (str.includes('€')) currency = 'EUR';
  return { min, max, currency };
}

function normalizeResult(raw, region) {
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company || 'Unknown Company').trim().substring(0, 200);
  const locationName = (raw.location || '').trim();

  let postedAt = null;
  if (raw.datePosted) {
    postedAt = new Date(raw.datePosted);
    if (isNaN(postedAt.getTime())) postedAt = null;
  }

  const url = raw.url || (raw.id ? `https://us.whatjobs.com/job/${raw.id}` : '');
  const description = (raw.description || '').trim();
  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region: locationName || region.toUpperCase(),
    platformSource: 'whatjobs',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    status: determineJobStatus(url),
    source: 'whatjobs',
    rawId: raw.id != null ? String(raw.id) : url,
    location: locationName,
    countryCode: region.toLowerCase(),
    description,
    salary: parseSalary(raw.salary),
    postedAt,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region, page) {
  const response = await fetchWithRetry(
    () =>
      axios.get(BASE_URL, {
        params: {
          keywords: keyword,
          page,
          ...(region && region !== 'intl' ? { location: region } : {}),
        },
        headers: {
          Authorization: `Bearer ${process.env.WHATJOBS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
        validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
      }),
    `WhatJobs/${keyword}/${region}/page${page}`
  );

  if (response.status === 404) return [];

  const jobListings = response.data && response.data.jobListings;
  if (!Array.isArray(jobListings) || jobListings.length === 0) return [];

  return jobListings
    .map((raw) => normalizeResult(raw, region))
    .filter((job) => {
      if (!job.title || !job.company || !job.url) return false;
      if (shouldExcludeCompany && shouldExcludeCompany(job.company)) return false;
      return true;
    });
}

async function fetchWhatJobs(
  keyword,
  regions = ["us", "gb", "de", "fr", "it", "es", "nl", "be", "ch", "at", 
  "ie", "lu", "se", "no", "dk", "fi", "pl", "cz", "ro", "hu", 
  "gr", "pt", "bg", "hr", "cy", "ee", "lv", "lt", "mt", "sk", 
  "si", "is", "li", "sg", "my", "ph", "id", "th", "vn", "ae", 
  "sa", "qa", "kw", "om", "bh", "pk"],
  seenFingerprints = new Set()
) {
  const allJobs = [];
  const skipTracker = createRegionSkipTracker(3);

  for (const region of regions) {
    let regionHadNewJobs = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const pageJobs = await fetchPage(keyword, region, page);
        if (pageJobs.length === 0) break;

        const uniqueJobs = pageJobs.filter((job) => {
          if (seenFingerprints.has(job.fingerprint)) return false;
          seenFingerprints.add(job.fingerprint);
          return true;
        });

        if (uniqueJobs.length === 0) {
          console.log(`[WHATJOBS] ${keyword}/${region} page ${page}: all duplicates, breaking`);
          break;
        }

        for (const j of uniqueJobs) delete j.fingerprint;
        allJobs.push(...uniqueJobs);
        regionHadNewJobs = true;
        console.log(`[WHATJOBS] ${keyword}/${region} page ${page}: ${uniqueJobs.length} jobs (${pageJobs.length - uniqueJobs.length} dupes/blocked)`);
      } catch (err) {
        console.error(`[WHATJOBS] ${keyword}/${region} page ${page} failed: ${err.message}`);
        break;
      }
    }
    if (skipTracker.onRegionDone(regionHadNewJobs)) break;
    if (regions.length > 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log(`[WHATJOBS] "${keyword}" total: ${allJobs.length} jobs across ${regions.length} regions`);
  return allJobs;
}

module.exports = { fetchWhatJobs };
