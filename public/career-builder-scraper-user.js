// ==UserScript==
// @name         CareerBuilder US Auto-Scraper (Stable Scroll + URL Fix)
// @namespace    http://localhost:3000/
// @version      2.2
// @description  Multi-selector company extraction + captcha-aware wait
// @author       JobScraper
// @match        *://*.careerbuilder.com/jobs*
// @match        *://*.careerbuilder.com/job-listings*
// @match        *://*.careerbuilder.com/job-listings/search*
// @grant        GM_xmlhttpRequest
// @grant        window.close
// @connect      localhost
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  var BACKEND_URL = 'http://localhost:3000/api/careerbuilder/upload-json';
  var SCRAPE_IDX = parseInt(new URLSearchParams(window.location.search).get('scrape_idx') || '0', 10);

  var allJobsAccumulator = new Map();

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function getRealJobCards() {
    return document.querySelectorAll('a.job-listing-item, [data-testid="job-search-card"], li.g-col, [class*="JobCard" i], article');
  }

  function isSkeletonPresent() {
    var skeletons = document.querySelectorAll('[class*="skeleton" i], [class*="Skeleton" i], [class*="loading" i]');
    if (skeletons.length > 0) return true;
    var cards = document.querySelectorAll('a.job-listing-item, [data-testid="job-search-card"], li.g-col');
    for (var i = 0; i < cards.length; i++) {
      if (!cards[i].innerText || cards[i].innerText.trim().length === 0) return true;
    }
    return false;
  }

  function getPageText() {
    var chunks = [];
    try { if (document.body && document.body.innerText) chunks.push(document.body.innerText); } catch (e) {}
    try { if (document.documentElement && document.documentElement.innerText) chunks.push(document.documentElement.innerText); } catch (e) {}
    return chunks.join(" \n ").toLowerCase();
  }

  function isCaptchaPresent() {
    var text = getPageText();
    var title = (document.title || "").toLowerCase();
    var markers = [
      "verify you are human", "checking your browser", "just a moment",
      "additional verification required", "please solve the captcha", "are you a robot",
      "performing security verification", "security service to protect",
      "verify you are not a bot", "one more step", "verification in progress",
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
    if (getRealJobCards().length > 0) return false;
    var text = getPageText();
    var markers = [
      "no jobs found", "0 jobs found", "we didn't find", "we couldn't find",
      "we could not find", "no results found", "no results matched",
      "did not match any", "try a different search", "try a new search",
    ];
    for (var i = 0; i < markers.length; i++) {
      if (text.indexOf(markers[i]) !== -1) return true;
    }
    return false;
  }

  async function waitForReady(maxWaitMs) {
    console.log('[CareerBuilder] Waiting up to ' + Math.round(maxWaitMs / 1000) + 's for page to be ready...');
    var start = Date.now();
    var lastLog = 0;
    while (Date.now() - start < maxWaitMs) {
      var captcha = isCaptchaPresent();
      var cards = getRealJobCards().length;
      var noResults = isNoResultsPage();
      if (Date.now() - lastLog > 3000) {
        console.log(
          '[CareerBuilder] ' + Math.round((Date.now() - start) / 1000) + 's: ' +
          'captcha=' + captcha + ' cards=' + cards + ' noResults=' + noResults
        );
        lastLog = Date.now();
      }
      if (!captcha && (cards > 0 || noResults)) {
        console.log('[CareerBuilder] Ready after ' + Math.round((Date.now() - start) / 1000) + 's.');
        return { ready: true, cards: cards, noResults: noResults };
      }
      await sleep(500);
    }
    console.log('[CareerBuilder] Timed out after ' + Math.round(maxWaitMs / 1000) + 's.');
    return { ready: false, cards: getRealJobCards().length, noResults: isNoResultsPage(), captcha: isCaptchaPresent() };
  }

  // ── Company extraction ──
  function isCompanyJunk(t) {
    if (!t) return true;
    var s = t.trim();
    if (s.length < 2 || s.length > 120) return true;
    if (s.indexOf('\n') !== -1) return true;
    if (/^[\d\s$€£¥,.+%/-]+$/.test(s)) return true;   // all digits/symbols
    if (/\$\d/.test(s)) return true;
    if (/^\s*\d+\+?\s*(jobs?|results?|days?|hours?|weeks?|months?)/i.test(s)) return true;
    if (/\b(hour|hours|day|days|week|weeks|month|months|year|years|ago)\b/i.test(s) &&
        !/\b(LLC|Inc|Corp|Ltd|GmbH|Co\.|Group|Company|Technologies|Solutions)\b/i.test(s)) return true;
    if (/^(quick|easy)\s+apply$/i.test(s)) return true;
    if (/^(save|share|apply|apply now|view)$/i.test(s)) return true;
    if (/^(new|featured|urgent)$/i.test(s)) return true;
    if (/^(remote|hybrid|on[- ]?site)$/i.test(s)) return true;
    if (/^(full[- ]?time|part[- ]?time|contract|temporary|internship|permanent)$/i.test(s)) return true;
    if (/^(salary|location|posted|posted on)\b/i.test(s)) return true;
    return false;
  }

  function extractCompany(card) {
    // 1. Explicit company/employer selectors
    var selectors = [
      '[data-testid*="company" i]',
      '[data-testid*="employer" i]',
      '[class*="company-name" i]',
      '[class*="companyName" i]',
      '[class*="employer-name" i]',
      '[class*="employerName" i]',
      '[class*="employer" i]',
      '[class*="company" i]',
      'a[href*="/company/"]',
      'a[href*="/employer/"]',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el;
      try { el = card.querySelector(selectors[i]); } catch (e) { el = null; }
      if (!el) continue;
      var txt = (el.innerText || '').trim().split('\n')[0].trim();
      if (!isCompanyJunk(txt)) return txt;
    }

    // 2. Text-scan fallback — company is usually above the title.
    var lines = (card.innerText || '')
      .split('\n')
      .map(function (l) { return l.trim(); })
      .filter(function (l) { return l.length > 0; });

    var titleEl = card.querySelector('h2, h3, [class*="job-title" i]');
    var titleText = titleEl ? (titleEl.innerText || '').trim() : '';

    // Pass A: prefer lines with a company suffix
    for (var a = 0; a < lines.length; a++) {
      var line = lines[a];
      if (line === titleText) continue;
      if (isCompanyJunk(line)) continue;
      if (/\b(LLC|Inc|Corp|Ltd|GmbH|Co\.|Limited|Technologies|Solutions|Systems|Group|Consulting|Software)\b/i.test(line)) return line;
    }

    // Pass B: first non-junk non-title line
    for (var b = 0; b < lines.length; b++) {
      var lineB = lines[b];
      if (lineB === titleText) continue;
      if (isCompanyJunk(lineB)) continue;
      return lineB;
    }

    return 'Unknown Company';
  }

  function scrapeAndAccumulate() {
    var cards = getRealJobCards();
    cards.forEach(function (card) {
      var linkEl = card.querySelector('a[href*="/job/"], a[href*="/job-details/"], h2 a, h3 a');
      var jobUrl = (linkEl && linkEl.href) ? linkEl.href : (card.getAttribute('href') || '');

      if (jobUrl && (jobUrl.includes('/job/') || jobUrl.includes('/job-details/'))) {
        var titleEl = card.querySelector('h2, h3, [class*="job-title" i], [class*="title" i], [data-testid*="title" i]');
        var locationEl = card.querySelector('[class*="location" i], [data-testid*="location" i]');

        var title = titleEl ? titleEl.innerText.trim() : 'No Title Found';
        var company = extractCompany(card);
        var location = locationEl ? locationEl.innerText.trim() : 'Unknown Location';

        allJobsAccumulator.set(jobUrl, {
          title: title,
          company: company,
          location: location,
          url: jobUrl,
          salary: '',
          scraped_at: new Date().toISOString()
        });
      }
    });
  }

  function sendAndClose() {
    var finalJobs = Array.from(allJobsAccumulator.values());
    console.log('[CareerBuilderScraper] Sending ' + finalJobs.length + ' total accumulated jobs...');

    var payload = {
      scrapeIdx: SCRAPE_IDX,
      platform: 'careerbuilder',
      jobs: finalJobs
    };

    GM_xmlhttpRequest({
      method: 'POST',
      url: BACKEND_URL,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify(payload),
      onload: function () { setTimeout(function () { window.close(); }, 1000); },
      onerror: function () { setTimeout(function () { window.close(); }, 1000); }
    });
  }

  async function runScraper() {
    console.log('[CareerBuilderScraper] v2.2 starting:', window.location.href.substring(0, 100));

    var startTs = Date.now();
    var HARD_CAP_MS = 40000;

    var r = await waitForReady(30000);
    if (!r.ready) {
      console.log('[CareerBuilderScraper] Never became ready. Bailing empty.');
      sendAndClose();
      return;
    }
    if (r.noResults) {
      console.log('[CareerBuilderScraper] No-results page. Bailing.');
      sendAndClose();
      return;
    }
    if (r.cards === 0) {
      console.log('[CareerBuilderScraper] No cards visible. Bailing.');
      sendAndClose();
      return;
    }

    console.log('[CareerBuilderScraper] Real jobs loaded. Starting scroll track...');
    var noChangeCount = 0;
    var maxScrollAttempts = 12;

    for (var i = 0; i < maxScrollAttempts; i++) {
      if (Date.now() - startTs > HARD_CAP_MS) {
        console.log('[CareerBuilderScraper] Hard cap hit. Sending accumulated jobs.');
        break;
      }
      scrapeAndAccumulate();

      var currentCards = getRealJobCards();
      var currentCount = currentCards.length;
      console.log('[CareerBuilderScraper] Loop ' + (i + 1) + ': Cards in DOM = ' + currentCount + ' | Total Accumulated = ' + allJobsAccumulator.size);

      var lastCard = currentCards[currentCount - 1];
      if (lastCard) {
        lastCard.scrollIntoView({ block: 'end', behavior: 'smooth' });
        setTimeout(function () { window.scrollBy(0, 200); }, 800);
      }

      await sleep(2500);

      var skeletonWaitTime = 0;
      while (isSkeletonPresent() && skeletonWaitTime < 6) {
        await sleep(1500);
        skeletonWaitTime++;
      }

      var postScrollCards = getRealJobCards();
      if (postScrollCards.length > currentCount) {
        noChangeCount = 0;
      } else {
        noChangeCount++;
        if (noChangeCount < 3 && postScrollCards.length > 3) {
          postScrollCards[postScrollCards.length - 3].scrollIntoView({ block: 'center', behavior: 'smooth' });
          await sleep(1500);
          continue;
        }
      }

      if (noChangeCount >= 3) break;
    }

    sendAndClose();
  }

  runScraper();
})();