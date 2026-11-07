// ==UserScript==
// @name         Indeed Auto-Scraper
// @namespace    http://localhost:3000/
// @version      3.3
// @description  Scrapes Indeed pages 1-3 with strict CAPTCHA detection and instant close.
// @match        https://*.indeed.com/jobs*
// @grant        window.close
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  var BACKEND_URL = 'http://localhost:3000/api/indeed/upload-json';
  var MAX_PAGES = 3;
  var POLL_MS = 1500;
  var IDX_KEY = 'indeed_scrape_idx';
  var JOBS_KEY = 'indeed_accumulated_jobs';
  var PAGE_KEY = 'indeed_current_page';

  // ── scrape_idx must survive multi-page navigation (next-page URLs drop it) ──
  var urlParams = new URLSearchParams(window.location.search);
  var idxFromUrl = parseInt(urlParams.get('scrape_idx') || '', 10);
  var SCRAPE_IDX;
  if (!isNaN(idxFromUrl)) {
    SCRAPE_IDX = idxFromUrl;
    sessionStorage.setItem(IDX_KEY, String(SCRAPE_IDX));
  } else {
    SCRAPE_IDX = parseInt(sessionStorage.getItem(IDX_KEY) || '0', 10);
    if (isNaN(SCRAPE_IDX)) SCRAPE_IDX = 0;
  }
  console.log('[IndeedScraper v3.1] scrape_idx = ' + SCRAPE_IDX);

  var accumulatedJobs = JSON.parse(sessionStorage.getItem(JOBS_KEY) || '[]');
  var currentPage = parseInt(sessionStorage.getItem(PAGE_KEY) || '1', 10);

  function isVisible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Bug 2 fix: only treat a CAPTCHA as present when an explicit, VISIBLE
  // challenge is rendered. Do NOT match lingering structural wrappers
  // (.cf-challenge / #challenge-form) or hidden fields (#g-recaptcha-response)
  // that remain in the DOM after a challenge has already been solved.
  function isCaptchaPresent() {
    var bodyText = document.body ? (document.body.innerText || '') : '';
    var title = document.title || '';

    // If any job cards are visible, we are NOT on a CAPTCHA page — regardless
    // of residual Cloudflare iframes still in the DOM. This kills the biggest
    // source of false positives.
    if (document.querySelectorAll('div.job_seen_beacon').length > 0) return false;

    // Strong text signals. Only phrases that appear on real Cloudflare
    // interstitial pages.
    var challengeRegex =
      /are you a robot|verify you are human|checking your browser|just a moment|additional verification required/i;
    if (challengeRegex.test(bodyText) || challengeRegex.test(title)) return true;

    // Structural check: only count an iframe as a challenge if it is
    // genuinely large and visible. A residual Cloudflare widget left in the
    // DOM after solving is typically 0×0 or hidden — this filters it out.
    var iframe = document.querySelector(
      '#challenge-stage, iframe[src*="challenges.cloudflare.com"], ' +
      'iframe[src*="hcaptcha.com"], iframe[src*="geo.captcha-delivery.com"]'
    );
    if (iframe) {
      var r = iframe.getBoundingClientRect();
      var style = window.getComputedStyle(iframe);
      if (
        r.width > 200 && r.height > 100 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        parseFloat(style.opacity) > 0.1
      ) {
        return true;
      }
    }
    return false;
  }

  function showCaptchaBanner() {
    if (document.getElementById('sc-captcha-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'sc-captcha-banner';
    banner.style.cssText =
      'position:fixed;top:0;left:0;width:100%;background-color:red;color:white;text-align:center;padding:15px;font-size:20px;font-weight:bold;z-index:99999;';
    banner.innerText = 'CAPTCHA DETECTED! PLEASE SOLVE THE CAPTCHA TO CONTINUE THE AUTOMATED LOOP.';
    document.body.appendChild(banner);
  }

  function removeCaptchaBanner() {
    var b = document.getElementById('sc-captcha-banner');
    if (b) b.remove();
  }

  function findNextButton() {
    var btn = document.querySelector('a[data-testid="pagination-page-next"]');
    if (btn) return btn;
    btn = document.querySelector('a[aria-label="Next Page"]') || document.querySelector('a[aria-label="Next"]');
    if (btn) return btn;
    var navLinks = document.querySelectorAll('nav a');
    for (var i = 0; i < navLinks.length; i++) {
      var link = navLinks[i];
      if (link.getAttribute('aria-label') === 'Next Page' || link.innerText.indexOf('Next') !== -1) {
        return link;
      }
    }
    return null;
  }

  function init() {
    var startTs = Date.now();
    var HARD_CAP_MS = 22000;                    // active scrape budget
    var CAPTCHA_MAX_WAIT_MS = 5 * 60 * 1000;    // 5 min for a human to solve
    var captchaFirstSeen = null;                // when CAPTCHA first appeared
    var captchaTotalWait = 0;                   // banked CAPTCHA time (ms)
    var emptyAttempts = 0;

    // Elapsed "active" time = wall clock minus all CAPTCHA waits (past and current).
    function activeElapsedMs() {
      var runningCaptcha = captchaFirstSeen ? (Date.now() - captchaFirstSeen) : 0;
      return Date.now() - startTs - captchaTotalWait - runningCaptcha;
    }

    var interval = setInterval(function () {
      if (isCaptchaPresent()) {
        if (captchaFirstSeen === null) {
          captchaFirstSeen = Date.now();
          console.log('[IndeedScraper] CAPTCHA detected. Waiting up to ' +
            Math.round(CAPTCHA_MAX_WAIT_MS / 1000) + 's for solve.');
        }
        showCaptchaBanner();
        if (Date.now() - captchaFirstSeen > CAPTCHA_MAX_WAIT_MS) {
          clearInterval(interval);
          console.warn('[IndeedScraper] CAPTCHA not solved within ' +
            Math.round(CAPTCHA_MAX_WAIT_MS / 1000) + 's. Bailing.');
          removeCaptchaBanner();
          sendDataAndClose();
        }
        return;
      }

      // CAPTCHA just cleared — bank its wait time so it doesn't count against HARD_CAP.
      if (captchaFirstSeen !== null) {
        var waited = Date.now() - captchaFirstSeen;
        captchaTotalWait += waited;
        console.log('[IndeedScraper] CAPTCHA solved after ' +
          Math.round(waited / 1000) + 's. Total banked: ' +
          Math.round(captchaTotalWait / 1000) + 's.');
        captchaFirstSeen = null;
      }
      removeCaptchaBanner();

      if (activeElapsedMs() > HARD_CAP_MS) {
        clearInterval(interval);
        console.warn('[IndeedScraper] Hard cap hit (' +
          Math.round(activeElapsedMs() / 1000) + 's active). Sending what we have.');
        sendDataAndClose();
        return;
      }

      var jobCards = document.querySelectorAll('div.job_seen_beacon');
      if (jobCards.length > 0) {
        clearInterval(interval);
        scrapeCurrentPage(jobCards);
      } else if (
        document.body.innerText.indexOf('did not match any jobs') !== -1 ||
        document.body.innerText.indexOf('No jobs match') !== -1
      ) {
        clearInterval(interval);
        sendDataAndClose();
      } else {
        emptyAttempts++;
        if (emptyAttempts >= 12) {
          clearInterval(interval);
          console.log('[IndeedScraper] No cards after ' + emptyAttempts + ' polls. Sending empty.');
          sendDataAndClose();
        }
      }
    }, POLL_MS);
  }

  function scrapeCurrentPage(jobCards) {
    var pageJobs = [];
    jobCards.forEach(function (card) {
      try {
        var titleEl = card.querySelector('h2.jobTitle, a[class*="jcs-JobTitle"]');
        var companyEl = card.querySelector('span[class*="companyName"], [data-testid="company-name"]');
        var locationEl = card.querySelector('div[class*="location"], [data-testid="text-location"]');
        var linkEl = card.querySelector('a[data-jk]');
        if (titleEl && linkEl) {
          pageJobs.push({
            title: titleEl.innerText.trim(),
            company: companyEl ? companyEl.innerText.trim() : 'Unknown',
            location: locationEl ? locationEl.innerText.trim() : 'Remote / Unknown',
            url: linkEl.href || 'https://www.indeed.com/viewjob?jk=' + linkEl.getAttribute('data-jk'),
          });
        }
      } catch (err) {
        console.error('[IndeedScraper] parsing error', err);
      }
    });

    accumulatedJobs = accumulatedJobs.concat(pageJobs);
    sessionStorage.setItem(JOBS_KEY, JSON.stringify(accumulatedJobs));

    var nextButton = findNextButton();
    if (currentPage < MAX_PAGES && nextButton && nextButton.href) {
      currentPage++;
      sessionStorage.setItem(PAGE_KEY, String(currentPage));

      // Preserve scrape_idx in the next-page URL so it can never be lost
      // (full page navigations drop unknown query params like scrape_idx).
      var nextUrl = nextButton.href;
      if (nextUrl.indexOf('scrape_idx=') === -1) {
        nextUrl += (nextUrl.indexOf('?') === -1 ? '?' : '&') + 'scrape_idx=' + SCRAPE_IDX;
      }
      window.location.href = nextUrl;
    } else {
      sendDataAndClose();
    }
  }

  // Bug 1 fix: close immediately on success, and also on error/timeout so the
  // tab never hangs waiting on the coordinator's poll timeout.
  function sendDataAndClose() {
    if (window.__scrapeDataSent) return;
    window.__scrapeDataSent = true;

    function cleanupAndClose() {
      sessionStorage.removeItem(JOBS_KEY);
      sessionStorage.removeItem(PAGE_KEY);
      sessionStorage.removeItem(IDX_KEY);
      try {
        window.close();
      } catch (e) {
        console.error('[IndeedScraper] window.close failed:', e);
      }
    }

    GM_xmlhttpRequest({
      method: 'POST',
      url: BACKEND_URL,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ scrapeIdx: SCRAPE_IDX, jobs: accumulatedJobs }),
      timeout: 30000,
      onload: function () {
        console.log('[IndeedScraper] Payload verified. Closing immediately.');
        cleanupAndClose();
      },
      onerror: function (err) {
        console.error('[IndeedScraper] Upload failed:', err);
        cleanupAndClose();
      },
      ontimeout: function () {
        console.error('[IndeedScraper] Upload timed out.');
        cleanupAndClose();
      },
    });
  }

  init();
})();
