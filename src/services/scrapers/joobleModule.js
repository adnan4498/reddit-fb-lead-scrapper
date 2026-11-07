const axios = require('axios');
const { fetchWithRetry } = require('./utils');
const { determineJobStatus } = require('../../utils/routing');
const { createRegionSkipTracker } = require('./regionSkip');

const JOOBLE_API_KEY = process.env.JOOBLE_API_KEY;

// const MAX_PAGES = 2;
const MAX_PAGES = 3;

// const JOOBLE_LOCATION_MAP = {
//   us: 'United States', uk: 'United Kingdom', ca: 'Canada', au: 'Australia', nz: 'New Zealand',
//   za: 'South Africa', in: 'India', sg: 'Singapore', my: 'Malaysia', th: 'Thailand',
//   ph: 'Philippines', pk: 'Pakistan', ae: 'United Arab Emirates', sa: 'Saudi Arabia',
//   ie: 'Ireland', fr: 'France', de: 'Germany', es: 'Spain', it: 'Italy', nl: 'Netherlands',
//   be: 'Belgium', ch: 'Switzerland', at: 'Austria', se: 'Sweden', no: 'Norway',
//   dk: 'Denmark', fi: 'Finland', pl: 'Poland', cz: 'Czech Republic', hu: 'Hungary',
//   ro: 'Romania', bg: 'Bulgaria', gr: 'Greece', tr: 'Turkey', br: 'Brazil',
//   mx: 'Mexico', ar: 'Argentina', cl: 'Chile', co: 'Colombia', pe: 'Peru',
//   ve: 'Venezuela', uy: 'Uruguay', ec: 'Ecuador', cr: 'Costa Rica', pa: 'Panama',
//   jp: 'Japan', kr: 'South Korea', hk: 'Hong Kong', tw: 'Taiwan', cn: 'China',
//   ru: 'Russia', ua: 'Ukraine', by: 'Belarus', kz: 'Kazakhstan', il: 'Israel',
//   eg: 'Egypt', ng: 'Nigeria', ke: 'Kenya', gh: 'Ghana', ma: 'Morocco',
//   id: 'Indonesia', vn: 'Vietnam',
// };

// const JOOBLE_REGIONS = [
//   'us', 'uk', 'ca', 'au', 'nz', 'za', 'in', 'sg', 'my', 'th',
//   'ph', 'pk', 'ae', 'sa', 'ie', 'fr', 'de', 'es', 'it', 'nl',
//   'be', 'ch', 'at', 'se', 'no', 'dk', 'fi', 'pl', 'cz', 'hu',
//   'ro', 'bg', 'gr', 'tr', 'br', 'mx', 'ar', 'cl', 'co', 'pe',
//   've', 'uy', 'ec', 'cr', 'pa', 'jp', 'kr', 'hk', 'tw', 'cn',
//   'ru', 'ua', 'by', 'kz', 'il', 'eg', 'ng', 'ke', 'gh', 'ma',
//   'id', 'vn',
// ];

const JOOBLE_LOCATION_MAP = {
  us: 'United States',
  gb: 'United Kingdom',
  de: 'Germany',
  fr: 'France',
  it: 'Italy',
  es: 'Spain',
  nl: 'Netherlands',
  be: 'Belgium',
  ch: 'Switzerland',
  at: 'Austria',
  ie: 'Ireland',
  lu: 'Luxembourg',
  se: 'Sweden',
  no: 'Norway',
  dk: 'Denmark',
  fi: 'Finland',
  pl: 'Poland',
  cz: 'Czech Republic',
  ro: 'Romania',
  hu: 'Hungary',
  gr: 'Greece',
  pt: 'Portugal',
  bg: 'Bulgaria',
  hr: 'Croatia',
  cy: 'Cyprus',
  ee: 'Estonia',
  lv: 'Latvia',
  lt: 'Lithuania',
  mt: 'Malta',
  sk: 'Slovakia',
  si: 'Slovenia',
  is: 'Iceland',
  li: 'Liechtenstein',
  sg: 'Singapore',
  my: 'Malaysia',
  ph: 'Philippines',
  id: 'Indonesia',
  th: 'Thailand',
  vn: 'Vietnam',
  ae: 'United Arab Emirates',
  sa: 'Saudi Arabia',
  qa: 'Qatar',
  kw: 'Kuwait',
  om: 'Oman',
  bh: 'Bahrain',
  pk: 'Pakistan'
};

const JOOBLE_REGIONS = [
  "us", "gb", "de", "fr", "it", "es", "nl", "be", "ch", "at", 
  "ie", "lu", "se", "no", "dk", "fi", "pl", "cz", "ro", "hu", 
  "gr", "pt", "bg", "hr", "cy", "ee", "lv", "lt", "mt", "sk", 
  "si", "is", "li", "sg", "my", "ph", "id", "th", "vn", "ae", 
  "sa", "qa", "kw", "om", "bh", "pk"
];

function buildSlug(title, company) {
  return `${title} ${company}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function computeTwoDayLookbackISO() {
  const d = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeJoobleResult(raw, region) {
  const title = (raw.title || 'Unknown Position').trim().substring(0, 300);
  const company = (raw.company || 'Unknown Company').trim().substring(0, 200);
  const url = (raw.link || '').trim();
  const locationName = (raw.location || '').trim();

  return {
    title,
    company,
    url,
    region: locationName || 'Remote',
    platformSource: 'Jooble',
    slug: buildSlug(title, company),
    scrapedAt: new Date(),
    source: 'jooble',
    rawId: raw.id ? String(raw.id) : url,
    location: locationName,
    countryCode: region.toLowerCase(),
    description: raw.snippet || '',
    status: determineJobStatus(url),
    salary: {
      min: null,
      max: null,
      currency: null,
    },
    postedAt: raw.updated ? new Date(raw.updated) : null,
    fetchedAt: new Date(),
  };
}

async function fetchPage(keyword, region, page) {
  const dateCreatedFrom = computeTwoDayLookbackISO();
  const url = `https://jooble.org/api/${JOOBLE_API_KEY}`;
  const targetLocation = JOOBLE_LOCATION_MAP[region.toLowerCase()] || '';

  const response = await fetchWithRetry(
    () =>
      axios.post(url, {
        keywords: keyword,
        location: targetLocation,
        dateCreatedFrom,
        page: String(page),
      }, { timeout: 30000 }),
    `Jooble/${region}/${keyword}/page${page}`
  );

  const jobs = response.data && response.data.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) return [];

  const currentCountryName = (JOOBLE_LOCATION_MAP[region.toLowerCase()] || '').toLowerCase();

  return jobs
    .map((raw) => {
      const jobLocation = (raw.location || '').toLowerCase();

      if (!jobLocation || jobLocation === 'remote' || jobLocation === 'anywhere') {
        return normalizeJoobleResult(raw, region);
      }

      for (const [key, value] of Object.entries(JOOBLE_LOCATION_MAP)) {
        const checkCountryName = value.toLowerCase();
        if (key.toLowerCase() !== region.toLowerCase() && jobLocation.includes(checkCountryName)) {
          return null;
        }
      }

      return normalizeJoobleResult(raw, region);
    })
    .filter(Boolean);
}

async function fetchJoobleJobs(keyword, regions = JOOBLE_REGIONS, seenFingerprints = null) {
  const allJobs = [];
  const skipTracker = createRegionSkipTracker(3);

  for (const region of regions) {
    let regionHadNewJobs = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      try {
        const pageJobs = await fetchPage(keyword, region, page);
        if (pageJobs.length === 0) break;

        if (seenFingerprints) {
          const uniquePageJobs = pageJobs.filter(job => {
            if (!job.title || !job.company) return false;
            const fp = `${job.title.toLowerCase().trim()}_${job.company.toLowerCase().trim()}`;
            if (seenFingerprints.has(fp)) return false;
            seenFingerprints.add(fp);
            return true;
          });
          if (uniquePageJobs.length === 0) {
            console.log(`[JOOBLE] ${region}/${keyword} page ${page}: all duplicates, breaking`);
            break;
          }
          allJobs.push(...uniquePageJobs);
          regionHadNewJobs = true;
          console.log(`[JOOBLE] ${region}/${keyword} page ${page}: ${uniquePageJobs.length} jobs (${pageJobs.length - uniquePageJobs.length} dupes dropped)`);
        } else {
          allJobs.push(...pageJobs);
          regionHadNewJobs = true;
          console.log(`[JOOBLE] ${region}/${keyword} page ${page}: ${pageJobs.length} jobs`);
        }
      } catch (err) {
        console.error(`[JOOBLE] ${region}/${keyword} page ${page} failed: ${err.message}`);
      }
    }

    if (skipTracker.onRegionDone(regionHadNewJobs)) break;
  }

  console.log(`[JOOBLE] ${keyword} total: ${allJobs.length} jobs across ${regions.length} regions`);
  return allJobs;
}

module.exports = { fetchJoobleJobs, JOOBLE_REGIONS };
