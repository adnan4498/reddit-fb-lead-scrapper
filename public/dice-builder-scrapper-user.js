// ==UserScript==
// @name         Dice Scraper V4.2
// @namespace    http://tampermonkey.net/
// @version      4.2
// @description  Broad title selectors + skip stale postings
// @match        *://*.dice.com/jobs*
// @grant        GM_xmlhttpRequest
// @grant        window.close
// @connect      localhost
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const DEBUG = false;
  const MAX_PAGES = 2;
  const STORAGE_KEY_PREFIX = 'dice_jobs_';

  // Jobs whose card shows "Posted N days ago" with N >= this value are
  // skipped. Dice's postedDate=ONE filter is unreliable (it seems to match
  // the "updated" date, not the "posted" date), so we enforce here.
  // Tune to taste: 1 = strict, 7 = lenient, 30 = catch only obvious cases.
  const MAX_POST_AGE_DAYS = 30;

  const urlParams = new URLSearchParams(window.location.search);
  const scrapeIdx = parseInt(urlParams.get('scrape_idx') || '0', 10);
  const STORAGE_KEY = STORAGE_KEY_PREFIX + scrapeIdx;

  let allJobs = new Map();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const arr = JSON.parse(stored);
      arr.forEach(job => allJobs.set(job.url, job));
      console.log(`[Dice] Loaded ${allJobs.size} jobs from localStorage`);
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function countJobCards() {
    return document.querySelectorAll('div[data-testid="job-card"]').length;
  }

  function isCaptchaPresent() {
    var text = "";
    try { if (document.body && document.body.innerText) text += document.body.innerText; } catch (e) {}
    try { if (document.documentElement && document.documentElement.innerText) text += " " + document.documentElement.innerText; } catch (e) {}
    text = text.toLowerCase();
    var title = (document.title || "").toLowerCase();

    var markers = [
      "verify you are human",
      "checking your browser",
      "just a moment",
      "additional verification required",
      "please solve the captcha",
      "are you a robot",
      "performing security verification",
      "security service to protect",
      "verify you are not a bot",
      "one more step",
      "verification in progress",
      "enable javascript and cookies to continue",
    ];
    for (var i = 0; i < markers.length; i++) {
      if (text.indexOf(markers[i]) !== -1 || title.indexOf(markers[i]) !== -1) return true;
    }

    try {
      var frame = document.querySelector(
        'iframe[src*="challenges.cloudflare.com"], #challenge-stage, #cf-challenge-running'
      );
      if (frame) {
        var r = frame.getBoundingClientRect();
        if (r.width > 100 && r.height > 50) return true;
      }
    } catch (e) {}
    return false;
  }

  function isNoResultsPage() {
    if (countJobCards() > 0) return false;
    var text = (document.body ? document.body.innerText || "" : "").toLowerCase();
    var markers = [
      "no results found",
      "we couldn't find any jobs",
      "we could not find any",
      "did not match any",
      "0 jobs",
      "0 results",
    ];
    for (var i = 0; i < markers.length; i++) {
      if (text.indexOf(markers[i]) !== -1) return true;
    }
    try {
      var emptyState = document.querySelector(
        '[data-testid*="no-results"], [class*="no-results" i], [class*="empty-state" i]'
      );
      if (emptyState) {
        var r = emptyState.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
    } catch (e) {}
    return false;
  }

  async function waitForReady(maxWaitMs, label) {
    console.log(`[Dice] Waiting up to ${Math.round(maxWaitMs / 1000)}s (${label})...`);
    var start = Date.now();
    var lastLog = 0;
    while (Date.now() - start < maxWaitMs) {
      var captcha = isCaptchaPresent();
      var cards = countJobCards();
      var noResults = isNoResultsPage();

      if (Date.now() - lastLog > 3000) {
        console.log(
          `[Dice] ${Math.round((Date.now() - start) / 1000)}s: ` +
          `captcha=${captcha} cards=${cards} noResults=${noResults}`
        );
        lastLog = Date.now();
      }

      if (!captcha && (cards > 0 || noResults)) {
        console.log(`[Dice] Ready after ${Math.round((Date.now() - start) / 1000)}s.`);
        return { ready: true, cards: cards, noResults: noResults };
      }
      await new Promise(r => setTimeout(r, 500));
    }
    console.log(`[Dice] Timed out after ${Math.round(maxWaitMs / 1000)}s.`);
    return {
      ready: false,
      cards: countJobCards(),
      noResults: isNoResultsPage(),
      captcha: isCaptchaPresent(),
    };
  }

  // ── FIX 1: robust title extraction ──
  function extractTitle(card) {
    var sels = [
      '[data-testid="job-search-job-detail-link"]',
      'h2', 'h3', 'h4',
      'a[href*="/job-detail/"]',
      '[data-testid*="job-title" i]',
    ];
    for (var i = 0; i < sels.length; i++) {
      var el = card.querySelector(sels[i]);
      if (el) {
        var t = (el.textContent || '').trim();
        if (t.length > 0) return t;
      }
    }
    return 'Unknown Title';
  }

  // ── FIX 2: reject stale postings ──
  // Parses Dice's card text like "Posted 60+ days ago", "30 days ago",
  // "2 days ago", "5 hours ago", "Posted today". Returns true when the
  // posting is older than MAX_POST_AGE_DAYS.
  function isTooOld(postedText) {
    if (!postedText) return false;
    var text = postedText.toLowerCase();

    // Any hour/minute/today/yesterday marker → recent, keep.
    if (text.indexOf('hour') !== -1 ||
        text.indexOf('minute') !== -1 ||
        text.indexOf('today') !== -1 ||
        text.indexOf('yesterday') !== -1 ||
        text.indexOf('just now') !== -1) {
      return false;
    }

    // Match "N days" or "N+ days"
    var m = text.match(/(\d+)\+?\s*days?/);
    if (!m) return false;

    var days = parseInt(m[1], 10);
    return days >= MAX_POST_AGE_DAYS;
  }

  function scrapeCurrentPage() {
    const cards = document.querySelectorAll('div[data-testid="job-card"]');
    let added = 0;
    let skippedOld = 0;

    cards.forEach(card => {
      const jobGuid = card.dataset.jobGuid || card.getAttribute('data-job-guid');
      if (!jobGuid) return;
      const url = 'https://www.dice.com/job-detail/' + jobGuid;
      if (allJobs.has(url)) return;

      const title = extractTitle(card);

      const companyEl = card.querySelector('p[data-testid="job-card-company-name"]');
      const company = companyEl ? companyEl.textContent.trim() : 'Unknown';

      const infoEl = card.querySelector('p.text-zinc-600');
      let location = 'Remote', posted = '';
      if (infoEl) {
        const parts = infoEl.textContent.split('•').map(s => s.trim());
        location = parts[0] || 'Remote';
        posted = parts[1] || '';
      }

      // FIX 2 applied here — skip stale postings before adding.
      if (isTooOld(posted)) {
        skippedOld++;
        console.log(`[Dice] Skipping stale: "${title}" — ${posted}`);
        return;
      }

      const salaryEl = card.querySelector('[aria-labelledby="salary-label"] p');
      const salary = salaryEl ? salaryEl.textContent.trim() : '';

      allJobs.set(url, { title, company, location, posted, salary, url, source: 'dice' });
      added++;
    });

    if (skippedOld > 0) {
      console.log(`[Dice] Skipped ${skippedOld} stale postings (>= ${MAX_POST_AGE_DAYS} days)`);
    }
    return added;
  }

  function getCurrentPage() {
    const section = document.querySelector('nav[aria-label="Pagination"] section[aria-label*="Page"]');
    if (!section) return 1;
    const pageEl = section.querySelector('.font-bold.text-white, .font-bold[aria-current]');
    if (pageEl) {
      const pageNum = parseInt(pageEl.textContent.trim(), 10);
      if (!isNaN(pageNum)) return pageNum;
    }
    const bolds = section.querySelectorAll('.font-bold');
    for (let el of bolds) {
      const val = parseInt(el.textContent.trim(), 10);
      if (!isNaN(val)) return val;
    }
    return 1;
  }

  function getTotalPages() {
    const section = document.querySelector('nav[aria-label="Pagination"] section[aria-label*="Page"]');
    if (!section) return 1;
    const bolds = section.querySelectorAll('.font-bold');
    let firstNum = null;
    for (let el of bolds) {
      const val = parseInt(el.textContent.trim(), 10);
      if (!isNaN(val)) {
        if (firstNum === null) firstNum = val;
        else return val;
      }
    }
    return 1;
  }

  function getPageUrl(pageNum) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', pageNum);
    return url.toString();
  }

  function saveJobs() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(allJobs.values())));
  }

  function uploadAndCleanup() {
    const jobsList = Array.from(allJobs.values());

    if (DEBUG) {
      console.log(`[Dice] Final job list (${jobsList.length} jobs):`, jobsList);
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    GM_xmlhttpRequest({
      method: 'POST',
      url: 'http://localhost:3000/api/dice/upload-json',
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ scrapeIdx: scrapeIdx, jobs: jobsList }),
      onload: () => {
        localStorage.removeItem(STORAGE_KEY);
        window.close();
      },
      onerror: (err) => {
        console.error('[Dice] Upload failed', err);
        try { window.close(); } catch (e) {}
      },
    });
  }

  async function runScraper() {
    console.log('[Dice] v4.2 starting:', window.location.href.substring(0, 100));

    const dismissButtons = document.querySelectorAll('button, a, [role="button"]');
    dismissButtons.forEach(btn => {
      const txt = btn.textContent.toLowerCase();
      if (
        txt.includes('accept') || txt.includes('agree') || txt.includes('close') ||
        txt.includes('got it') || txt.includes('continue') || txt.includes('ok')
      ) {
        btn.click();
      }
    });

    var r = await waitForReady(45000, "page load");
    if (!r.ready) {
      console.log('[Dice] Never became ready. Bailing empty.');
      uploadAndCleanup();
      return;
    }
    if (r.noResults) {
      console.log('[Dice] No-results page. Bailing.');
      uploadAndCleanup();
      return;
    }
    if (r.cards === 0) {
      console.log('[Dice] No cards visible. Bailing.');
      uploadAndCleanup();
      return;
    }

    const added = scrapeCurrentPage();
    const currentPage = getCurrentPage();
    const totalPages = getTotalPages();
    console.log(`[Dice] Page ${currentPage}: +${added} jobs (total ${allJobs.size})`);
    console.log(`[Dice] Current page = ${currentPage}, total pages = ${totalPages}`);
    saveJobs();

    const nextPage = currentPage + 1;
    const limit = Math.min(MAX_PAGES, totalPages);
    if (nextPage <= limit) {
      console.log(`[Dice] Navigating to page ${nextPage}...`);
      const nextUrl = getPageUrl(nextPage);
      saveJobs();
      window.location.href = nextUrl;
    } else {
      console.log(`[Dice] Reached limit (${limit}). Done.`);
      uploadAndCleanup();
    }
  }

  runScraper();
})();