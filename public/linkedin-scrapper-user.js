// ==UserScript==
// @name         LinkedIn Scraper V2.4
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Page-limited scraping with robust login/content polling
// @match        *://*.linkedin.com/jobs/search*
// @match        *://*.linkedin.com/jobs/search-results*
// @match        *://*.linkedin.com/jobs/collections*
// @grant        GM_xmlhttpRequest
// @grant        window.close
// @connect      localhost
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;
  const MAX_PAGES = 3;               // 25 results/page × 3 = 75 max per target
  const STORAGE_KEY_PREFIX = 'linkedin_jobs_';
  const PAGE_KEY_PREFIX = 'linkedin_page_';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Card selectors (broad — LinkedIn varies by A/B test) ──
  const CARD_SELECTORS = [
    '.job-card-container',
    '.jobs-search__job-card-container',
    'li[data-occludable-job-id]',
    'div[data-job-id]',
    'li.jobs-search-results__list-item',
  ];
  const CARD_QUERY = CARD_SELECTORS.join(', ');

  function getCards() {
    return document.querySelectorAll(CARD_QUERY);
  }

  function isLoggedIn() {
    // Visible job cards → we're effectively logged in for scraping.
    if (getCards().length > 0) return true;
    return !!(
      document.querySelector('.global-nav__me-v2-photo') ||
      document.querySelector('.global-nav__me-photo') ||
      document.querySelector('.nav__profile-photo') ||
      document.querySelector('.global-nav__primary-link-me-menu-trigger') ||
      document.querySelector('img[alt*="profile"]') ||
      document.querySelector('.feed-identity-module__actor-avatar')
    );
  }

  function isLoginWall() {
    // LinkedIn's auth wall on /jobs/search
    var url = window.location.href;
    if (url.indexOf('/login') !== -1 || url.indexOf('/checkpoint') !== -1) return true;
    var text = (document.body ? document.body.innerText || "" : "").toLowerCase();
    return (
      text.indexOf('sign in to linkedin') !== -1 ||
      text.indexOf('join linkedin to see') !== -1 ||
      text.indexOf('authwall') !== -1
    );
  }

  function isBlockedPage() {
    var text = (document.body ? document.body.innerText || "" : "").toLowerCase();
    return (
      text.indexOf('unusual activity') !== -1 ||
      text.indexOf('temporarily restricted') !== -1 ||
      text.indexOf('verify your identity') !== -1 ||
      text.indexOf('security verification') !== -1 ||
      text.indexOf('are you a robot') !== -1
    );
  }

  function hasEndOfResultsMarker() {
    try {
      var noResults = document.querySelector(
        '.jobs-search-no-results, .artdeco-empty-state, .jobs-search-reached-end, [data-test-no-results]'
      );
      if (noResults) return true;
      var body = (document.body ? document.body.textContent || "" : "").toLowerCase();
      if (body.indexOf('no matching jobs found') !== -1) return true;
      if (body.indexOf("we're having issues loading your results") !== -1) return true;
    } catch (e) {}
    return false;
  }

  function getCurrentOffset() {
    const params = new URLSearchParams(window.location.search);
    return parseInt(params.get('start') || '0', 10);
  }

  function getPageUrl(offset) {
    const url = new URL(window.location.href);
    url.searchParams.set('start', offset);
    url.searchParams.delete('currentJobId');
    return url.toString();
  }

  // ── Poll for content OR a terminal state ──
  async function waitForContent(maxWaitMs) {
    console.log(`[LinkedIn] Waiting up to ${Math.round(maxWaitMs / 1000)}s for content...`);
    var start = Date.now();
    var lastLog = 0;
    while (Date.now() - start < maxWaitMs) {
      var cards = getCards().length;
      var blocked = isBlockedPage();
      var loginWall = isLoginWall();
      var endMarker = hasEndOfResultsMarker();

      if (Date.now() - lastLog > 3000) {
        console.log(
          `[LinkedIn] ${Math.round((Date.now() - start) / 1000)}s: ` +
          `cards=${cards} blocked=${blocked} loginWall=${loginWall} end=${endMarker}`
        );
        lastLog = Date.now();
      }

      if (blocked) return { state: 'blocked' };
      if (loginWall) return { state: 'login_wall' };
      if (cards > 0) return { state: 'cards', count: cards };
      if (endMarker) return { state: 'no_results' };

      await sleep(500);
    }

    return {
      state: 'timeout',
      cards: getCards().length,
      blocked: isBlockedPage(),
      loginWall: isLoginWall(),
    };
  }

  function scrapeVisibleJobs(allJobs) {
    const cards = getCards();
    console.log(`[LinkedIn] Scraping ${cards.length} cards`);

    let added = 0;
    let noLink = 0;

    cards.forEach(card => {
      const link = card.querySelector('a[href*="/jobs/view/"]');
      if (!link) { noLink++; return; }
      let url = link.href;
      if (url.indexOf('?') !== -1) url = url.split('?')[0];
      if (allJobs.has(url)) return;

      // ── Title ──
      let title = 'Unknown';
      const titleSelectors = [
        '.job-title',
        '.base-search-card__title',
        '[data-test-job-title]',
        '.job-card-search__title',
        '.job-card-list__title',
        'a[data-tracking-control-name]',
        'h3', 'h2', 'strong.job-title',
      ];
      for (const sel of titleSelectors) {
        const el = card.querySelector(sel);
        if (el && el.textContent.trim()) { title = el.textContent.trim(); break; }
      }
      if (title === 'Unknown' && link.textContent.trim()) {
        title = link.textContent.trim();
      }

      // ── Company ──
      let company = 'Unknown';
      const companySelectors = [
        '.company-name',
        '.base-search-card__subtitle',
        '[data-test-company-name]',
        '.job-card-container__company-name',
        '.job-card-search__company-name',
        '.job-card-list__company-name',
        '.artdeco-entity-lockup__subtitle',
        '.company-name-link',
      ];
      for (const sel of companySelectors) {
        const el = card.querySelector(sel);
        if (el && el.textContent.trim()) { company = el.textContent.trim(); break; }
      }
      if (company === 'Unknown') {
        const spans = card.querySelectorAll('span');
        for (const span of spans) {
          const cls = span.className || '';
          const txt = span.textContent.trim();
          if ((cls.indexOf('company') !== -1 || cls.indexOf('employer') !== -1) && txt) {
            company = txt; break;
          }
        }
      }

      // ── Location ──
      let location = 'Remote';
      const locationSelectors = [
        '.job-location',
        '.base-search-card__metadata',
        '[data-test-location]',
        '.job-card-container__metadata-item',
        '.job-card-list__location',
      ];
      for (const sel of locationSelectors) {
        const el = card.querySelector(sel);
        if (el && el.textContent.trim()) {
          const locText = el.textContent.trim();
          location = locText.toLowerCase().indexOf('remote') !== -1 ? 'Remote' : locText;
          break;
        }
      }

      // ── Salary ──
      let salary = '';
      const salarySelectors = ['.salary', '[data-test-salary]', '.job-card-container__salary'];
      for (const sel of salarySelectors) {
        const el = card.querySelector(sel);
        if (el && el.textContent.trim()) { salary = el.textContent.trim(); break; }
      }

      // ── Posted time ──
      let postedAt = '';
      const timeSelectors = [
        '.posted-time',
        '.job-search-card__listdate',
        '[data-test-posted-date]',
        '.job-card-container__posted-date',
        'time',
      ];
      for (const sel of timeSelectors) {
        const el = card.querySelector(sel);
        if (el && el.textContent.trim()) { postedAt = el.textContent.trim(); break; }
      }

      // ── Country heuristic ──
      let countryCode = 'US';
      const locLower = location.toLowerCase();
      if (locLower.indexOf('uk') !== -1 || locLower.indexOf('united kingdom') !== -1) countryCode = 'GB';
      else if (locLower.indexOf('canada') !== -1) countryCode = 'CA';
      else if (locLower.indexOf('india') !== -1) countryCode = 'IN';
      else if (locLower.indexOf('germany') !== -1 || locLower.indexOf('deutschland') !== -1) countryCode = 'DE';
      else if (locLower.indexOf('france') !== -1) countryCode = 'FR';
      else if (locLower.indexOf('australia') !== -1) countryCode = 'AU';
      else if (locLower.indexOf('netherlands') !== -1) countryCode = 'NL';

      allJobs.set(url, { title, company, location, salary, postedAt, url, source: 'linkedin', countryCode });
      added++;
    });

    if (noLink > 0) console.log(`[LinkedIn] ${noLink} cards had no job link — skipped`);
    return added;
  }

  function uploadAndCleanup(allJobs, scrapeIdx, storageKey) {
    const jobsList = Array.from(allJobs.values());

    if (DEBUG) {
      console.log(`[LinkedIn] DEBUG (${jobsList.length} jobs):`, jobsList);
      localStorage.removeItem(storageKey);
      return;
    }

    console.log(`[LinkedIn] Uploading ${jobsList.length} jobs for idx=${scrapeIdx}`);

    GM_xmlhttpRequest({
      method: 'POST',
      url: 'http://localhost:3000/api/linkedin/upload-json',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ scrapeIdx: scrapeIdx, jobs: jobsList }),
      onload: () => {
        localStorage.removeItem(storageKey);
        console.log('[LinkedIn] Upload complete.');
        try { window.close(); } catch (e) {}
      },
      onerror: (err) => {
        console.error('[LinkedIn] Upload failed', err);
        try { window.close(); } catch (e) {}
      },
    });
  }

  async function runScraper() {
    console.log('[LinkedIn] v2.4 starting:', window.location.href.substring(0, 100));

    const urlParams = new URLSearchParams(window.location.search);
    const scrapeIdx = parseInt(urlParams.get('scrape_idx') || '0', 10);
    const STORAGE_KEY = STORAGE_KEY_PREFIX + scrapeIdx;
    const PAGE_KEY = PAGE_KEY_PREFIX + scrapeIdx;

    let allJobs = new Map();
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const arr = JSON.parse(stored);
        arr.forEach(job => allJobs.set(job.url, job));
        console.log(`[LinkedIn] Loaded ${allJobs.size} jobs from localStorage`);
      } catch (e) { localStorage.removeItem(STORAGE_KEY); }
    }

    // ── Page counter ──
    let pageCount = parseInt(sessionStorage.getItem(PAGE_KEY) || '1', 10);
    console.log(`[LinkedIn] Page ${pageCount} of max ${MAX_PAGES}`);

    // ── Wait for content ──
    var r = await waitForContent(20000);

    if (r.state === 'blocked') {
      console.log('[LinkedIn] Blocked page detected. Bailing empty.');
      uploadAndCleanup(allJobs, scrapeIdx, STORAGE_KEY);
      sessionStorage.removeItem(PAGE_KEY);
      return;
    }
    if (r.state === 'login_wall') {
      console.log('[LinkedIn] Login wall. Bailing empty.');
      uploadAndCleanup(allJobs, scrapeIdx, STORAGE_KEY);
      sessionStorage.removeItem(PAGE_KEY);
      return;
    }
    if (r.state === 'no_results') {
      console.log('[LinkedIn] No-results page. Bailing.');
      uploadAndCleanup(allJobs, scrapeIdx, STORAGE_KEY);
      sessionStorage.removeItem(PAGE_KEY);
      return;
    }
    if (r.state === 'timeout') {
      console.log('[LinkedIn] Timed out waiting for content. Bailing.');
      uploadAndCleanup(allJobs, scrapeIdx, STORAGE_KEY);
      sessionStorage.removeItem(PAGE_KEY);
      return;
    }
    // r.state === 'cards'

    const added = scrapeVisibleJobs(allJobs);
    console.log(`[LinkedIn] Page ${pageCount}: +${added} jobs (total ${allJobs.size})`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(allJobs.values())));

    // ── Page limit check ──
    if (pageCount >= MAX_PAGES) {
      console.log(`[LinkedIn] Page limit reached (${MAX_PAGES}). Uploading.`);
      uploadAndCleanup(allJobs, scrapeIdx, STORAGE_KEY);
      sessionStorage.removeItem(PAGE_KEY);
      return;
    }

    // ── Next-page detection ──
    const nextButton = document.querySelector(
      'button[aria-label="View next page"], .jobs-search-pagination__button--next'
    );
    const isDisabled = nextButton && (
      nextButton.hasAttribute('disabled') ||
      nextButton.getAttribute('aria-disabled') === 'true'
    );
    if (isDisabled) {
      console.log('[LinkedIn] Next button disabled — end of results.');
      uploadAndCleanup(allJobs, scrapeIdx, STORAGE_KEY);
      sessionStorage.removeItem(PAGE_KEY);
      return;
    }

    const currentOffset = getCurrentOffset();
    const nextOffset = currentOffset + 25;
    const nextUrl = getPageUrl(nextOffset);

    pageCount++;
    sessionStorage.setItem(PAGE_KEY, String(pageCount));
    console.log(`[LinkedIn] Navigating to page ${pageCount}: ${nextUrl}`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(allJobs.values())));
    window.location.href = nextUrl;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { runScraper(); });
  } else {
    runScraper();
  }
})();