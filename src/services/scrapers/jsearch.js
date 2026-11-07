const axios = require('axios');

const API_KEY =
  process.env.JSEARCH_RAPID_API_KEY ||
  process.env.JSEARCH_RAPIDAPI_KEY ||
  process.env['JSEARCH-RAPID-API-KEY'];

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const VALID_DATE_FILTERS = ['all', 'today', '3days', 'week', 'month'];

// ---- List of possible configurations to try ----
const CONFIGS = [
  { host: 'jsearch.p.rapidapi.com', endpoint: '/search' },
  { host: 'jsearch.p.rapidapi.com', endpoint: '/search-v2' },
  { host: 'jssearch.p.rapidapi.com', endpoint: '/jobs' },
];

function buildHeaders(host) {
  if (!API_KEY) {
    throw new Error('[JSEARCH] API key missing.');
  }
  return {
    'x-rapidapi-key': API_KEY,
    'x-rapidapi-host': host,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

// ---- Normalization functions (unchanged) ----
function normalizeLocation(raw) {
  const parts = [];
  if (raw.job_city) parts.push(raw.job_city);
  if (raw.job_state) parts.push(raw.job_state);
  if (raw.job_country) {
    parts.push(raw.job_country.length <= 3 ? raw.job_country.toUpperCase() : raw.job_country);
  }
  return parts.join(', ') || (raw.job_location || '').trim();
}

function normalizeWorkspace(raw) {
  if (raw.job_is_remote === true || raw.job_is_remote === 'true' || raw.job_is_remote === 1) {
    return 'remote';
  }
  const text = [raw.job_title || '', raw.job_description || '', raw.job_employment_type || '']
    .join(' ')
    .toLowerCase();
  if (/\bhybrid\b/.test(text)) return 'hybrid';
  if (/\bon[-]?site\b|\bin[-]office\b/.test(text) && !/\bremote\b|\bwfh\b/.test(text)) {
    return 'onsite';
  }
  return 'onsite';
}

function parsePostedDate(raw) {
  if (raw.job_posted_at_datetime_utc) {
    const d = new Date(raw.job_posted_at_datetime_utc);
    if (!isNaN(d.getTime())) return d;
  }
  if (raw.job_posted_at_timestamp != null) {
    const ts = Number(raw.job_posted_at_timestamp);
    if (!isNaN(ts) && ts > 0) {
      const d = new Date(ts < 1000000000000 ? ts * 1000 : ts);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function normalizeResult(raw) {
  const postedAt = parsePostedDate(raw);
  return {
    id: raw.job_id || '',
    title: (raw.job_title || 'Untitled').trim(),
    company: (raw.employer_name || 'Unknown').trim(),
    location: normalizeLocation(raw),
    workspace: normalizeWorkspace(raw),
    applyUrl: (raw.job_apply_link || raw.job_google_link || '').trim(),
    description: (raw.job_description || '').trim(),
    postedAt,
    rawPostedAt: raw.job_posted_at_datetime_utc || raw.job_posted_at_timestamp || null,
  };
}

async function tryRequest(host, endpoint, params) {
  const url = `https://${host}${endpoint}`;
  const headers = buildHeaders(host);
  console.log(`[JSEARCH] Trying ${url} with params:`, params);

  try {
    const response = await axios.get(url, {
      headers,
      params,
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return response.data;
  } catch (err) {
    const status = err.response?.status;
    const msg = err.response?.data?.message || err.message;
    console.log(`[JSEARCH] ${host}${endpoint} → ${status || 'error'}: ${msg}`);
    // Re-throw so caller can handle
    throw err;
  }
}

async function fetchJobs(searchParams = {}) {
  if (!API_KEY) {
    console.error('[JSEARCH] API key not configured – skipping.');
    return [];
  }

  const { query, page = 1, maxPages = 2, datePosted = 'today', country = 'US' } = searchParams;

  if (!query) {
    console.error('[JSEARCH] fetchJobs: query is required (e.g., "react developer in US")');
    return [];
  }

  const dateParam = VALID_DATE_FILTERS.includes(datePosted) ? datePosted : '3days';
  const allJobs = [];

  // Try each configuration until one works
  for (const config of CONFIGS) {
    const { host, endpoint } = config;
    let success = false;

    for (let p = Number(page); p < Number(page) + Number(maxPages); p++) {
      const params = {
        query,              // include location like "react developer in US"
        page: String(p),
        date_posted: dateParam,
        // Some endpoints need 'country' separately – we can add it.
        country: country.toUpperCase(),
      };

      try {
        const data = await tryRequest(host, endpoint, params);
        const rawData = data?.data;
        if (!Array.isArray(rawData) || rawData.length === 0) {
          console.log(`[JSEARCH] ${host}${endpoint} page ${p}: empty, breaking`);
          break;
        }

        const now = Date.now();
        const jobs = rawData
          .map((raw) => normalizeResult(raw))
          .filter((job) => {
            if (!job.id || !job.title) return false;
            if (job.postedAt) {
              const age = now - job.postedAt.getTime();
              if (age > TWO_DAYS_MS) return false;
            }
            return true;
          });

        allJobs.push(...jobs);
        console.log(`[JSEARCH] ${host}${endpoint} page ${p}: ${jobs.length} jobs fetched`);
        success = true;

        if (rawData.length < 10) break;
      } catch (err) {
        // If we get 403/404/429, try next config
        break;
      }
    }

    if (success) {
      console.log(`[JSEARCH] Using ${host}${endpoint} – total ${allJobs.length} jobs`);
      break;
    } else {
      console.log(`[JSEARCH] ${host}${endpoint} failed – trying next configuration.`);
    }
  }

  if (allJobs.length === 0) {
    console.warn('[JSEARCH] No working configuration found. Skipping JSearch.');
  }

  return allJobs;
}

// ---- fetchJobDetails (unchanged, but uses jssearch) ----
async function fetchJobDetails(jobId, country = 'US') {
  if (!API_KEY) return null;
  if (!jobId) return null;

  const host = 'jssearch.p.rapidapi.com';
  const endpoint = '/job-details';
  const url = `https://${host}${endpoint}`;
  const headers = buildHeaders(host);

  try {
    const response = await axios.get(url, {
      headers,
      params: {
        job_id: jobId,
        country: country.toUpperCase(),
        extended_publisher_details: 'false',
      },
      timeout: 30000,
    });
    const rawData = response.data?.data;
    if (!Array.isArray(rawData) || rawData.length === 0) return null;
    const raw = rawData[0];
    return {
      id: raw.job_id || jobId,
      title: (raw.job_title || 'Untitled').trim(),
      company: (raw.employer_name || 'Unknown').trim(),
      companyWebsite: (raw.employer_website || '').trim(),
      companyLogo: (raw.employer_logo || '').trim(),
      location: normalizeLocation(raw),
      workspace: normalizeWorkspace(raw),
      applyUrl: (raw.job_apply_link || raw.job_google_link || '').trim(),
      description: (raw.job_description || '').trim(),
      qualifications: (raw.job_highlights?.Qualifications) || [],
      responsibilities: (raw.job_highlights?.Responsibilities) || [],
      benefits: (raw.job_highlights?.Benefits) || [],
      employmentType: raw.job_employment_type || null,
      salary: raw.job_min_salary || raw.job_max_salary
        ? {
            min: raw.job_min_salary != null ? Number(raw.job_min_salary) : null,
            max: raw.job_max_salary != null ? Number(raw.job_max_salary) : null,
            currency: raw.job_salary_currency || null,
            period: raw.job_salary_period || null,
          }
        : null,
      postedAt: parsePostedDate(raw) || raw.job_posted_at_datetime_utc || raw.job_posted_at_timestamp || null,
    };
  } catch (err) {
    console.error(`[JSEARCH] job-details error: ${err.message}`);
    return null;
  }
}

module.exports = { fetchJobs, fetchJobDetails };