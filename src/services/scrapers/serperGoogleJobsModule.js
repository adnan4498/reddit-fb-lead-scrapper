// const axios = require('axios');
// const { fetchWithRetry } = require('./utils');

// const SERPER_API_KEY = process.env.SERPER_API_KEY;
// const BASE_URL = 'https://google.serper.dev/search';

// const MAX_PAGES = 2;
// const ONE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

// // ────────── Global ATS platforms (used for every region) ──────────
// const GLOBAL_ATS = [
//   'greenhouse.io',
//   'lever.co',
//   'ashbyhq.com',
//   'workable.com',
//   'jobvite.com',
//   'smartrecruiters.com',
//   'myworkdayjobs.com',
//   'bamboohr.com',
//   'recruitee.com',
//   'applytojob.com',
//   'trakstar.com',
//   'jobtarget.com',
//   'careers-page.com',
//   'applytojobs.com',
//   'pinpointhq.com',
//   'fountain.com',
//   'breezy.hr',
//   'comeet.co'
// ].map(domain => `site:${domain}`).join(' OR ');

// // ────────── Region-specific configuration ──────────
// const REGIONS_CONFIG = {
//   us: {
//     localSites: [],
//     locationPhrase: '',
//     hl: 'en'
//   },
//   gb: {
//     localSites: ['site:reed.co.uk', 'site:totaljobs.com', 'site:indeed.co.uk'],
//     locationPhrase: 'london',
//     hl: 'en'
//   },
//   de: {
//     localSites: ['site:stepstone.de', 'site:xing.com/jobs', 'site:indeed.de'],
//     locationPhrase: 'berlin OR münchen OR remote deutschland',
//     hl: 'de'
//   },
//   fr: {
//     localSites: ['site:apec.fr', 'site:cadremploi.fr', 'site:indeed.fr'],
//     locationPhrase: 'paris OR lyon OR télétravail',
//     hl: 'fr'
//   },
//   nl: {
//     localSites: ['site:indeed.nl', 'site:nationalevacaturebank.nl'],
//     locationPhrase: 'amsterdam OR rotterdam OR remote nederland',
//     hl: 'nl'
//   },
//   se: {
//     localSites: ['site:arbetsformedlingen.se', 'site:indeed.se'],
//     locationPhrase: 'stockholm OR distans',
//     hl: 'sv'
//   },
//   dk: {
//     localSites: ['site:jobindex.dk', 'site:indeed.dk'],
//     locationPhrase: 'københavn OR remote danmark',
//     hl: 'da'
//   },
//   no: {
//     localSites: ['site:finn.no/jobb', 'site:indeed.no'],
//     locationPhrase: 'oslo OR hjemmekontor',
//     hl: 'no'
//   },
//   ca: {
//     localSites: ['site:indeed.ca', 'site:workopolis.com'],
//     locationPhrase: 'toronto OR vancouver OR remote canada',
//     hl: 'en'
//   },
//   au: {
//     localSites: ['site:seek.com.au', 'site:indeed.com.au'],
//     locationPhrase: 'sydney OR melbourne OR remote australia',
//     hl: 'en'
//   },
//   in: {
//     localSites: ['site:naukri.com', 'site:shine.com', 'site:indeed.co.in'],
//     locationPhrase: 'bangalore OR mumbai OR remote india',
//     hl: 'en'
//   },
//   br: {
//     localSites: ['site:indeed.com.br', 'site:catho.com.br'],
//     locationPhrase: 'são paulo OR remoto brasil',
//     hl: 'pt'
//   },
//   mx: {
//     localSites: ['site:indeed.com.mx', 'site:occ.com.mx'],
//     locationPhrase: 'ciudad de méxico OR remoto méxico',
//     hl: 'es'
//   },
//   sg: {
//     localSites: ['site:indeed.com.sg', 'site:jobsdb.com'],
//     locationPhrase: 'singapore OR remote singapore',
//     hl: 'en'
//   },
//   ae: {
//     localSites: ['site:bayt.com', 'site:indeed.ae'],
//     locationPhrase: 'dubai OR remote uae',
//     hl: 'en'
//   }
// };

// const DEFAULT_REGIONS = Object.keys(REGIONS_CONFIG);

// function buildSlug(title, company) {
//   return `${title} ${company}`
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, '-')
//     .replace(/^-+|-+$/g, '')
//     .substring(0, 200);
// }

// function normalizeResult(raw, region) {
//   const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
//   const url = (raw.link || '').trim();

//   let company = 'Unknown Company';
//   if (url) {
//     try {
//       const urlObj = new URL(url);
//       company = urlObj.hostname.replace('www.', '');
//     } catch (e) {}
//   }

//   const locationName = (raw.location || '').trim();
//   const postedAt = raw.date ? new Date(raw.date) : null;

//   if (postedAt && (Date.now() - postedAt.getTime()) > ONE_DAYS_MS) {
//     return null;
//   }

//   const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

//   return {
//     fingerprint,
//     title,
//     company,
//     url,
//     region: locationName || region.toUpperCase(),
//     platformSource: 'serper',
//     slug: buildSlug(title, company),
//     scrapedAt: new Date(),
//     source: 'serper',
//     rawId: url,
//     location: locationName,
//     countryCode: region.toLowerCase(),
//     description: (raw.snippet || '').trim(),
//     salary: { min: null, max: null, currency: null },
//     postedAt,
//     fetchedAt: new Date(),
//   };
// }

// async function fetchPage(keyword, region, page) {
//   const config = REGIONS_CONFIG[region] || { localSites: [], locationPhrase: '', hl: 'en' };

//   const siteParts = [GLOBAL_ATS];
//   if (config.localSites.length > 0) {
//     siteParts.push(...config.localSites);
//   }
//   const siteQuery = siteParts.join(' OR ');

//   // CHANGE: Removed the hardcoded "remote" keyword to capture all job types
//   const locationQuery = config.locationPhrase ? ` ${config.locationPhrase}` : '';
//   const searchQuery = `${siteQuery} "${keyword}"${locationQuery}`;

//   const payload = {
//     q: searchQuery,
//     gl: region,
//     page,
//   };
//   if (config.hl) payload.hl = config.hl;

//   const response = await fetchWithRetry(
//     () =>
//       axios.post(BASE_URL, payload, {
//         headers: {
//           'X-API-KEY': SERPER_API_KEY,
//           'Content-Type': 'application/json',
//         },
//         timeout: 30000,
//         validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
//       }),
//     `Serper/${region}/${keyword}/page${page}`
//   );

//   if (response.status === 404) return [];

//   const jobs = response.data && response.data.organic;
//   if (!Array.isArray(jobs) || jobs.length === 0) return [];

//   return jobs
//     .map((raw) => normalizeResult(raw, region))
//     .filter(Boolean);
// }

// async function fetchSerperGoogleJobs(keyword, regions = DEFAULT_REGIONS, seenFingerprints = new Set()) {
//   const targetRegions = Array.isArray(regions) ? regions : DEFAULT_REGIONS;
//   const allJobs = [];

//   for (const region of targetRegions) {
//     if (!REGIONS_CONFIG[region]) {
//       console.log(`[SERPER] Skipping unsupported region: ${region}`);
//       continue;
//     }

//     for (let page = 1; page <= MAX_PAGES; page++) {
//       try {
//         const pageJobs = await fetchPage(keyword, region, page);
//         if (pageJobs.length === 0) break;

//         const uniquePageJobs = pageJobs.filter(job => {
//           if (!job.title || !job.company) return false;
//           if (seenFingerprints.has(job.fingerprint)) return false;
//           seenFingerprints.add(job.fingerprint);
//           return true;
//         });
//         if (uniquePageJobs.length === 0) {
//           console.log(`[SERPER] ${region}/${keyword} page ${page}: all duplicates, breaking`);
//           break;
//         }

//         for (const j of uniquePageJobs) delete j.fingerprint;
//         allJobs.push(...uniquePageJobs);
//         console.log(`[SERPER] ${region}/${keyword} page ${page}: ${uniquePageJobs.length} jobs (${pageJobs.length - uniquePageJobs.length} dupes)`);
//       } catch (err) {
//         console.error(`[SERPER] ${region}/${keyword} page ${page} failed: ${err.message}`);
//       }
//     }
//     if (targetRegions.length > 1) {
//       await new Promise(r => setTimeout(r, 1000));
//     }
//   }

//   console.log(`[SERPER] ${keyword} total: ${allJobs.length} jobs across ${targetRegions.length} regions`);
//   return allJobs;
// }

// module.exports = { fetchSerperGoogleJobs };




const axios = require('axios');
const { determineJobStatus } = require('../../utils/routing');
const { createRegionSkipTracker } = require('./regionSkip');
const { fetchWithRetry } = require('./utils');

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const BASE_URL = 'https://google.serper.dev/search';

const MAX_PAGES = 2;                     // deeper per loop
const ONE_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

// ────────── Global ATS platforms (Loop A) ──────────
const GLOBAL_ATS_QUERY = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'workable.com',
  'jobvite.com',
  'smartrecruiters.com',
  'myworkdayjobs.com',
  'bamboohr.com',
  'recruitee.com',
  'applytojob.com',
  'trakstar.com',
  'jobtarget.com',
  'careers-page.com',
  'applytojobs.com',
  'pinpointhq.com',
  'fountain.com',
  'breezy.hr',
  'comeet.co'
].map(domain => `site:${domain}`).join(' OR ');

// ────────── Region-specific local platforms (Loop B, 10 regions) ──────────
const REGIONS_CONFIG = {
  us: {
    localSites: ['site:dice.com', 'site:linkedin.com', 'site:indeed.com', 'site:ziprecruiter.com'],
    locationPhrase: 'remote OR "united states" OR "new york" OR "san francisco"',
    hl: 'en'
  },
  gb: {
    localSites: ['site:reed.co.uk', 'site:totaljobs.com', 'site:indeed.co.uk', 'site:linkedin.com', 'site:ziprecruiter.co.uk/jobs', 'site:dice.com'],
    locationPhrase: 'london OR manchester OR remote uk',
    hl: 'en'
  },
  de: {
    localSites: ['site:stepstone.de', 'site:xing.com/jobs', 'site:indeed.de', 'site:linkedin.com', 'site:ziprecruiter.de/jobs', 'site:dice.com'],
    locationPhrase: 'berlin OR münchen OR remote deutschland',
    hl: 'de'
  },
  fr: {
    localSites: ['site:apec.fr', 'site:cadremploi.fr', 'site:indeed.fr', 'site:linkedin.com', 'site:ziprecruiter.com', 'site:dice.com'],
    locationPhrase: 'paris OR lyon OR télétravail',
    hl: 'fr'
  },
  ca: {
    localSites: ['site:indeed.ca', 'site:workopolis.com', 'site:linkedin.com', 'site:ziprecruiter.ca/jobs', 'site:dice.com'],
    locationPhrase: 'toronto OR vancouver OR remote canada',
    hl: 'en'
  },
  au: {
    localSites: ['site:seek.com.au', 'site:indeed.com.au', 'site:linkedin.com', 'site:ziprecruiter.com', 'site:dice.com'],
    locationPhrase: 'sydney OR melbourne OR remote australia',
    hl: 'en'
  },
  in: {
    localSites: ['site:naukri.com', 'site:shine.com', 'site:indeed.co.in', 'site:linkedin.com', 'site:ziprecruiter.com', 'site:dice.com'],
    locationPhrase: 'bangalore OR mumbai OR remote india',
    hl: 'en'
  },
  br: {
    localSites: ['site:indeed.com.br', 'site:catho.com.br', 'site:linkedin.com', 'site:ziprecruiter.com', 'site:dice.com'],
    locationPhrase: 'são paulo OR remoto brasil',
    hl: 'pt'
  },
  mx: {
    localSites: ['site:indeed.com.mx', 'site:occ.com.mx', 'site:linkedin.com', 'site:ziprecruiter.com', 'site:dice.com'],
    locationPhrase: 'ciudad de méxico OR remoto méxico',
    hl: 'es'
  },
  sg: {
    localSites: ['site:indeed.com.sg', 'site:jobsdb.com', 'site:linkedin.com', 'site:ziprecruiter.com', 'site:dice.com'],
    locationPhrase: 'singapore OR remote singapore',
    hl: 'en'
  }
};

const DEFAULT_REGIONS = Object.keys(REGIONS_CONFIG);   // 10 regions

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function normalizeResult(raw, region) {
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const url = (raw.link || '').trim();

  let company = 'Unknown Company';
  if (url) {
    try {
      const urlObj = new URL(url);
      company = urlObj.hostname.replace('www.', '');
    } catch (e) {}
  }

  const locationName = (raw.location || '').trim();
  const postedAt = raw.date ? new Date(raw.date) : null;

  if (postedAt && (Date.now() - postedAt.getTime()) > ONE_DAYS_MS) {
    return null;
  }

  const fingerprint = `${title.toLowerCase().trim()}_${company.toLowerCase().trim()}`;

  return {
    fingerprint,
    title,
    company,
    url,
    region: locationName || region.toUpperCase(),
    platformSource: 'serper',
    slug: buildSlug(title, company),
    status: determineJobStatus(url),
    scrapedAt: new Date(),
    source: 'serper',
    rawId: url,
    location: locationName,
    countryCode: region.toLowerCase(),
    description: (raw.snippet || '').trim(),
    salary: { min: null, max: null, currency: null },
    postedAt,
    fetchedAt: new Date(),
  };
}

// ────────── Generic page fetcher ──────────
async function fetchPage(siteQuery, keyword, region, page, hl) {
  const config = REGIONS_CONFIG[region] || { locationPhrase: '', hl: 'en' };
  const locationPhrase = config.locationPhrase || '';
  const locationQuery = locationPhrase ? ` ${locationPhrase}` : '';
  const searchQuery = `${siteQuery} "${keyword}"${locationQuery}`;

  const payload = { q: searchQuery, gl: region, page };
  if (hl) payload.hl = hl;

  const response = await fetchWithRetry(
    () => axios.post(BASE_URL, payload, {
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      validateStatus: (status) => (status >= 200 && status < 300) || status === 404,
    }),
    `Serper/${region}/${keyword}/page${page}`
  );

  if (response.status === 404) return [];
  const jobs = response.data && response.data.organic;
  if (!Array.isArray(jobs) || jobs.length === 0) return [];

  return jobs
    .map((raw) => normalizeResult(raw, region))
    .filter(Boolean);
}

// ────────── Main orchestrator with two loops ──────────
async function fetchSerperGoogleJobs(keyword, regions = DEFAULT_REGIONS, seenFingerprints = new Set()) {
  const targetRegions = Array.isArray(regions) ? regions : DEFAULT_REGIONS;
  const allJobs = [];
  const skipTracker = createRegionSkipTracker(3);

  for (const region of targetRegions) {
    let regionHadNewJobs = false;
    if (!REGIONS_CONFIG[region]) {
      console.log(`[SERPER] Skipping unsupported region: ${region}`);
      continue;
    }

    const config = REGIONS_CONFIG[region];
    const localQuery = config.localSites.join(' OR ');

    // --- Loop A: Global ATS platforms ---
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const pageJobs = await fetchPage(GLOBAL_ATS_QUERY, keyword, region, page, config.hl);
        if (pageJobs.length === 0) break;

        const uniq = pageJobs.filter(job => {
          if (!job.title || !job.company) return false;
          if (seenFingerprints.has(job.fingerprint)) return false;
          seenFingerprints.add(job.fingerprint);
          return true;
        });
        if (uniq.length === 0) {
          console.log(`[SERPER/ATS] ${region}/${keyword} page ${page}: all duplicates, breaking`);
          break;
        }
        for (const j of uniq) delete j.fingerprint;
        allJobs.push(...uniq);
        regionHadNewJobs = true;
        console.log(`[SERPER/ATS] ${region}/${keyword} page ${page}: ${uniq.length} jobs`);
      } catch (err) {
        console.error(`[SERPER/ATS] ${region}/${keyword} page ${page} failed: ${err.message}`);
      }
    }

    // --- Loop B: Local/regional platforms ---
    if (localQuery) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        try {
          const pageJobs = await fetchPage(localQuery, keyword, region, page, config.hl);
          if (pageJobs.length === 0) break;

          const uniq = pageJobs.filter(job => {
            if (!job.title || !job.company) return false;
            if (seenFingerprints.has(job.fingerprint)) return false;
            seenFingerprints.add(job.fingerprint);
            return true;
          });
          if (uniq.length === 0) {
            console.log(`[SERPER/LOCAL] ${region}/${keyword} page ${page}: all duplicates, breaking`);
            break;
          }
          for (const j of uniq) delete j.fingerprint;
          allJobs.push(...uniq);
          regionHadNewJobs = true;
          console.log(`[SERPER/LOCAL] ${region}/${keyword} page ${page}: ${uniq.length} jobs`);
        } catch (err) {
          console.error(`[SERPER/LOCAL] ${region}/${keyword} page ${page} failed: ${err.message}`);
        }
      }
    }

    // Rate‑limit pause between regions
    if (targetRegions.length > 1) {
      await new Promise(r => setTimeout(r, 1000));
    }

    if (skipTracker.onRegionDone(regionHadNewJobs)) break;
  }

  console.log(`[SERPER] ${keyword} total: ${allJobs.length} jobs across ${targetRegions.length} regions`);
  return allJobs;
}

module.exports = { fetchSerperGoogleJobs };