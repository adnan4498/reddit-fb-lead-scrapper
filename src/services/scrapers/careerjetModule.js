// const axios = require("axios");
// const { fetchWithRetry } = require("./utils");

// const CAREERJET_API_KEY = process.env.CAREERJET_API_KEY;
// const BASE_URL = "https://search.api.careerjet.net/v4/query";
// // const BASE_URL = "https://careerjet.net";

// const MAX_PAGES = 1;
// const PAGE_SIZE = 100;

// const CAREERJET_REGIONS = [
//   'us', 'nl', 'gb', 'au', 'ca', 'in', 'za', 'fr',
//   'de', 'es', 'it', 'at', 'be', 'br', 'mx', 'nz',
//   'pl', 'sg', 'se', 'no', 'dk', 'fi', 'ch', 'ie',
//   'jp', 'kr', 'cn', 'hk', 'tw', 'ru', 'tr', 'ar',
//   'cl', 'co', 'pe', 've', 'uy', 'ec',
// ];

// // const CAREERJET_REGIONS = ["us","au"];

// function buildSlug(title, company) {
//   return `${title} ${company}`
//     .toLowerCase()
//     .replace(/[^a-z0-9]+/g, "-")
//     .replace(/^-+|-+$/g, "")
//     .substring(0, 200);
// }

// function normalizeCareerjetResult(raw, region) {
//   const title = (raw.title || "Unknown Position").trim().substring(0, 300);
//   const company = (raw.company || "Unknown Company").trim().substring(0, 200);
//   const url = (raw.url || "").trim();
//   const locationName = (raw.locations || "").trim();

//   return {
//     title,
//     company,
//     url,
//     region: locationName || region.toUpperCase(),
//     platformSource: "careerjet",
//     slug: buildSlug(title, company),
//     scrapedAt: new Date(),
//     source: "careerjet",
//     rawId: String(raw.id || ""),
//     location: locationName,
//     countryCode: region.toLowerCase(),
//     description: (raw.description || "").trim(),
//     salary: { min: null, max: null, currency: null },
//     postedAt: raw.date ? new Date(raw.date) : null,
//     fetchedAt: new Date(),
//   };
// }

// // async function fetchPage(keyword, region, page) {
// //   const encodedKeyword = encodeURIComponent(`${keyword} remote`);
// //   const offset = (page - 1) * PAGE_SIZE;

// //   const response = await fetchWithRetry(
// //     () =>
// //       axios.get(BASE_URL, {
// //         params: {
// //           keywords: encodedKeyword,
// //           location: region,
// //           pagesize: PAGE_SIZE,
// //           offset,
// //           affid: CAREERJET_API_KEY,
// //           user_ip: '82.165.195.1',
// //           user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
// //         },
// //         auth: {
// //           username: CAREERJET_API_KEY,
// //           password: '',
// //         },
// //         headers: {
// //           'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
// //         },
// //         timeout: 30000,
// //       }),
// //     `Careerjet/${region}/${keyword}/page${page}`,
// //   );

// //   const data = response.data || {};

// //   if (data.type === "LOCATIONS" || !Array.isArray(data.jobs)) {
// //     return [];
// //   }

// //   return data.jobs.map((raw) => normalizeCareerjetResult(raw, region));
// // }

// async function fetchPage(keyword, region, page) {
//   const offset = (page - 1) * PAGE_SIZE;
  
//   // Format regional inputs into Careerjet's strict locale structures (e.g., us -> en_US)
//   const localeCode = region.toLowerCase() === 'us' ? 'en_US' : `en_${region.toUpperCase()}`;

//   const response = await fetchWithRetry(
//     () =>
//       axios.get(BASE_URL, {
//         params: {
//           keywords: keyword,   // Raw search term handled natively by Axios
//           locale_code: localeCode, // Authoritative parameter targeting the region nationwide
//           page: page,
//           page_size: PAGE_SIZE,
//           offset,
//           user_ip: '82.165.195.1',
//           user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
//         },
//         auth: {
//           username: CAREERJET_API_KEY,
//           password: '',
//         },
//         headers: {
//           'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
//           'Referer': 'http://localhost:3000', // Mandatory header to pass the security firewall
//         },
//         timeout: 30000,
//       }),
//     `Careerjet/${region}/${keyword}/page${page}`,
//   );

//   const data = response.data || {};

//   if (data.type === "LOCATIONS" || !Array.isArray(data.jobs)) {
//     return [];
//   }

//   return data.jobs.map((raw) => normalizeCareerjetResult(raw, region));
// }

// async function fetchCareerjetJobs(
//   keyword,
//   regions = CAREERJET_REGIONS,
//   seenFingerprints = null,
// ) {
//   const allJobs = [];

//   for (const region of regions) {
//     for (let page = 1; page <= MAX_PAGES; page++) {
//       try {
//         const pageJobs = await fetchPage(keyword, region, page);
//         if (pageJobs.length === 0) break;

//         if (seenFingerprints) {
//           const uniquePageJobs = pageJobs.filter((job) => {
//             if (!job.title || !job.company) return false;
//             const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
//             if (seenFingerprints.has(fp)) return false;
//             seenFingerprints.add(fp);
//             return true;
//           });
//           if (uniquePageJobs.length === 0) break;
//           allJobs.push(...uniquePageJobs);
//           console.log(
//             `[CAREERJET] ${region}/${keyword} page ${page}: ${uniquePageJobs.length} jobs (${pageJobs.length - uniquePageJobs.length} dupes)`,
//           );
//         } else {
//           allJobs.push(...pageJobs);
//           console.log(
//             `[CAREERJET] ${region}/${keyword} page ${page}: ${pageJobs.length} jobs`,
//           );
//         }
//       } catch (err) {
//         console.error(
//           `[CAREERJET] ${region}/${keyword} page ${page} failed: ${err.message}`,
//         );
//       }
//     }
//   }

//   console.log(
//     `[CAREERJET] ${keyword} total: ${allJobs.length} jobs across ${regions.length} regions`,
//   );
//   return allJobs;
// }

// module.exports = { fetchCareerjetJobs, CAREERJET_REGIONS };



const axios = require("axios");
const { fetchWithRetry } = require("./utils");
const { determineJobStatus } = require("../../utils/routing");
const { createRegionSkipTracker } = require("./regionSkip");

const CAREERJET_API_KEY = process.env.CAREERJET_API_KEY;
const BASE_URL = "https://search.api.careerjet.net/v4/query";

const MAX_PAGES = 2;
const PAGE_SIZE = 100;

// const CAREERJET_REGIONS = [
//   'us', 'nl', 'gb', 'au', 'ca', 'in', 'za', 'fr',
//   'de', 'es', 'it', 'at', 'be', 'br', 'mx', 'nz',
//   'pl', 'sg', 'se', 'no', 'dk', 'fi', 'ch', 'ie',
//   'jp', 'kr', 'cn', 'hk', 'tw', 'ru', 'tr', 'ar',
//   'cl', 'co', 'pe', 've', 'uy', 'ec',
// ];

const CAREERJET_REGIONS = [
  "us", "gb", "de", "fr", "it", "es", "nl", "be", "ch", "at", 
  "ie", "lu", "se", "no", "dk", "fi", "pl", "cz", "ro", "hu", 
  "gr", "pt", "bg", "hr", "cy", "ee", "lv", "lt", "mt", "sk", 
  "si", "is", "li", "sg", "my", "ph", "id", "th", "vn", "ae", 
  "sa", "qa", "kw", "om", "bh", "pk"
];

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 200);
}

// function normalizeCareerjetResult(raw, region) {
//   const title = (raw.title || "Unknown Position").trim().substring(0, 300);
//   const company = (raw.company || "Unknown Company").trim().substring(0, 200);
//   const url = (raw.url || "").trim();
//   const locationName = (raw.locations || "").trim();

//   return {
//     title,
//     company,
//     url,
//     region: locationName || region.toUpperCase(),
//     platformSource: "careerjet",
//     slug: buildSlug(title, company),
//     scrapedAt: new Date(),
//     source: "careerjet",
//     rawId: String(raw.id || ""),
//     location: locationName,
//     countryCode: region.toLowerCase(),
//     // description: (raw.description || "").trim(),
//     description: (raw.description || "").replace(/<[^>]*>/g, '').trim(),
//     salary: { min: null, max: null, currency: null },
//     postedAt: raw.date ? new Date(raw.date) : null,
//     fetchedAt: new Date(),
//   };
// }

function normalizeCareerjetResult(raw, region) {
  const title = (raw.title || "Unknown Position").trim().substring(0, 300);
  const company = (raw.company || "Unknown Company").trim().substring(0, 200);
  const url = (raw.url || "").trim();
  const locationName = (raw.locations || "").trim();

  // 1. Establish the explicit 3-day freshness checkpoint
  const ONE_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
  const postedAt = raw.date ? new Date(raw.date) : null;

  // 2. Kill the processing immediately if the job is older than 72 hours
  if (postedAt && (Date.now() - postedAt.getTime()) > ONE_DAYS_MS) {
    return null;
  }

  return {
    title,
    company,
    url,
    region: locationName || region.toUpperCase(),
    platformSource: "careerjet",
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    source: "careerjet",
    rawId: String(raw.id || ""),
    location: locationName,
    countryCode: region.toLowerCase(),
    // Clean description to remove any HTML tag elements coming out of the endpoint payload
    description: (raw.description || "").replace(/<[^>]*>/g, '').trim(),
    status: determineJobStatus(url),
    salary: { min: null, max: null, currency: null },
    postedAt,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region, page) {
  const offset = (page - 1) * PAGE_SIZE;
  
  // Authoritative global locale dictionary matching Careerjet REST spec signatures
  const localeMap = {
    us: 'en_US', gb: 'en_GB', au: 'en_AU', ca: 'en_CA', in: 'en_IN', za: 'en_ZA', ie: 'en_IE', 
    nz: 'en_NZ', sg: 'en_SG', ae: 'en_AE', hk: 'zh_HK', tw: 'zh_TW', cn: 'zh_CN', nl: 'nl_NL', 
    fr: 'fr_FR', de: 'de_DE', es: 'es_ES', it: 'it_IT', at: 'de_AT', be: 'nl_BE', br: 'pt_BR', 
    mx: 'es_MX', pl: 'pl_PL', se: 'sv_SE', no: 'no_NO', dk: 'da_DK', fi: 'fi_FI', ch: 'de_CH', 
    jp: 'ja_JP', kr: 'ko_KR', ru: 'ru_RU', tr: 'tr_TR', ar: 'es_AR', cl: 'es_CL', co: 'es_CO', 
    pe: 'es_PE', ve: 'es_VE', uy: 'es_UY', ec: 'es_EC'
  };

  const localeCode = localeMap[region.toLowerCase()] || 'en_GB';

  const response = await fetchWithRetry(
    () =>
      axios.get(BASE_URL, {
        params: {
          keywords: keyword,   
          locale_code: localeCode, 
          sort: 'date',
          page: page,
          page_size: PAGE_SIZE,
          offset,
          user_ip: '82.165.195.1',
          user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        auth: {
          username: CAREERJET_API_KEY,
          password: '',
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'http://localhost:3000', 
        },
        timeout: 30000,
      }),
    `Careerjet/${region}/${keyword}/page${page}`,
  );

  const data = response.data || {};

  if (data.type === "LOCATIONS" || !Array.isArray(data.jobs)) {
    return [];
  }

  // return data.jobs.map((raw) => normalizeCareerjetResult(raw, region));
  return data.jobs.map((raw) => normalizeCareerjetResult(raw, region)).filter(Boolean);
}

async function fetchCareerjetJobs(
  keyword,
  regions = CAREERJET_REGIONS,
  seenFingerprints = null,
) {
  const allJobs = [];
  const skipTracker = createRegionSkipTracker(3);

  for (const region of regions) {
    let regionHadNewJobs = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const pageJobs = await fetchPage(keyword, region, page);
        if (pageJobs.length === 0) break;

        if (seenFingerprints) {
          const uniquePageJobs = pageJobs.filter((job) => {
            if (!job.title || !job.company) return false;
            const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
            if (seenFingerprints.has(fp)) return false;
            seenFingerprints.add(fp);
            return true;
          });
          if (uniquePageJobs.length === 0) continue; // Changed from break to continue to preserve subsequent pages
          allJobs.push(...uniquePageJobs);
          regionHadNewJobs = true;
          console.log(
            `[CAREERJET] ${region}/${keyword} page ${page}: ${uniquePageJobs.length} jobs (${pageJobs.length - uniquePageJobs.length} dupes)`,
          );
        } else {
          allJobs.push(...pageJobs);
          regionHadNewJobs = true;
          console.log(
            `[CAREERJET] ${region}/${keyword} page ${page}: ${pageJobs.length} jobs`,
          );
        }
      } catch (err) {
        console.error(
          `[CAREERJET] ${region}/${keyword} page ${page} failed: ${err.message}`,
        );
      }
    }

    if (skipTracker.onRegionDone(regionHadNewJobs)) break;
  }

  console.log(
    `[CAREERJET] ${keyword} total: ${allJobs.length} jobs across ${regions.length} regions`,
  );
  return allJobs;
}

module.exports = { fetchCareerjetJobs, CAREERJET_REGIONS };