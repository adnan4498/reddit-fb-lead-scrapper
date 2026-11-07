// ==UserScript==
// @name         SimplyHired Scraper V3.1
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Robust captcha wait; no URL rewriting during challenge
// @include      /^https?:\/\/[^\/]*simplyhired\.[a-z.]+\//
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @run-at       document-end
// ==/UserScript==

(function () {
  "use strict";

  const DEBUG = false;
  const MAX_PAGES = 3;
  const STORAGE_KEY_PREFIX = "simplyhired_jobs_";

  if (window.location.pathname === "/post-jobs") {
    const originalUrl = sessionStorage.getItem("simplyhired_original_url");
    if (originalUrl) {
      sessionStorage.removeItem("simplyhired_original_url");
      setTimeout(() => { window.location.href = originalUrl; }, 3000);
    } else {
      window.location.href = "https://" + window.location.hostname;
    }
    return;
  }

  if (window.location.pathname === "/about/cookies") {
    const allBtns = document.querySelectorAll('button, a[role="button"]');
    for (const btn of allBtns) {
      const txt = btn.textContent.toLowerCase();
      if (txt.includes("accept") || txt.includes("agree") || txt.includes("got it")) {
        btn.click();
        break;
      }
    }
    const originalUrl = sessionStorage.getItem("simplyhired_original_url");
    if (originalUrl) {
      sessionStorage.removeItem("simplyhired_original_url");
      window.location.href = originalUrl;
    } else {
      window.location.reload();
    }
    return;
  }

  // ── scrape_idx — READ ONLY, no URL manipulation ──
  const urlParams = new URLSearchParams(window.location.search);
  var rawIdx = urlParams.get("scrape_idx");
  var scrapeIdx;
  if (rawIdx !== null && !isNaN(parseInt(rawIdx, 10))) {
    scrapeIdx = parseInt(rawIdx, 10);
    sessionStorage.setItem("simplyhired_scrape_idx", String(scrapeIdx));
  } else {
    var storedIdx = sessionStorage.getItem("simplyhired_scrape_idx");
    scrapeIdx = storedIdx !== null ? parseInt(storedIdx, 10) : 0;
    if (isNaN(scrapeIdx)) scrapeIdx = 0;
  }
  // NOTE: deliberately NOT rewriting the URL. Cloudflare re-triggers if the
  // URL changes during the challenge, and the param being there is harmless.

  const STORAGE_KEY = STORAGE_KEY_PREFIX + scrapeIdx;
  sessionStorage.setItem("simplyhired_original_url", window.location.href);

  let allJobs = new Map();
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const arr = JSON.parse(stored);
      arr.forEach((job) => allJobs.set(job.url, job));
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function isHomepage() {
    var p = window.location.pathname;
    return p === "/" || p === "" || p === "/index.htm" || p === "/index.html";
  }

  // ── Robust text collection ──
  function getPageText() {
    var chunks = [];
    try { if (document.body && document.body.innerText) chunks.push(document.body.innerText); } catch (e) {}
    try { if (document.body && document.body.textContent) chunks.push(document.body.textContent); } catch (e) {}
    try { if (document.documentElement && document.documentElement.innerText) chunks.push(document.documentElement.innerText); } catch (e) {}
    return chunks.join(" \n ").toLowerCase();
  }

  function getTitleText() {
    var t = "";
    try { if (document.title) t += " " + document.title; } catch (e) {}
    try {
      var tel = document.querySelector("title");
      if (tel && tel.textContent) t += " " + tel.textContent;
    } catch (e) {}
    return t.toLowerCase();
  }

  function isCaptchaPresent() {
    var text = getPageText();
    var title = getTitleText();

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
      "verifies you are not a bot",
      "enable javascript and cookies to continue",
    ];
    for (var i = 0; i < markers.length; i++) {
      if (text.indexOf(markers[i]) !== -1 || title.indexOf(markers[i]) !== -1) return true;
    }

    // Cloudflare challenge iframe (managed challenge)
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
    if (document.querySelectorAll('a[href*="/job/"]').length > 0) return false;
    var text = getPageText();
    var markers = [
      "we found no offers",
      "no offers for",
      "could not find any",
      "couldn't find any",
      "we could not find",
      "we couldn't find",
      "did not match any",
      "remove active filters",
      "disable active filters",
      "tips to improve search",
      "go back to a recent search",
      "clear all filters",
      "aucune offre",
      "keine angebote",
      "no encontramos ofertas",
      "nessuna offerta",
      "geen vacatures",
      "brak ofert",
      "não encontramos",
      "no encontramos empleos",
    ];
    for (var i = 0; i < markers.length; i++) {
      if (text.indexOf(markers[i]) !== -1) return true;
    }
    return false;
  }

  function countJobLinks() {
    return document.querySelectorAll('a[href*="/job/"]').length;
  }

  // ── Combined wait: captcha clears AND content loads ──
  async function waitForCaptchaAndContent(maxWaitMs, label) {
    console.log("[SimplyHired] Waiting up to " + Math.round(maxWaitMs / 1000) + "s (" + label + ")...");
    var start = Date.now();
    var lastLog = 0;
    var sawCaptchaOnce = false;

    while (Date.now() - start < maxWaitMs) {
      var captcha = isCaptchaPresent();
      var jobs = countJobLinks();
      var noResults = isNoResultsPage();

      if (captcha) sawCaptchaOnce = true;

      if (Date.now() - lastLog > 3000) {
        console.log(
          "[SimplyHired] " + Math.round((Date.now() - start) / 1000) + "s: " +
          "captcha=" + captcha + " jobs=" + jobs + " noResults=" + noResults
        );
        lastLog = Date.now();
      }

      // Success: no captcha AND we have content.
      if (!captcha && (jobs > 0 || noResults)) {
        console.log("[SimplyHired] Ready after " + Math.round((Date.now() - start) / 1000) + "s.");
        return { cleared: true, jobs: jobs, noResults: noResults };
      }

      // Special case: no captcha and no content at all — page is a homepage.
      if (!captcha && jobs === 0 && !noResults && isHomepage()) {
        console.log("[SimplyHired] Redirected to homepage. Closing.");
        return { cleared: true, homepage: true, jobs: 0, noResults: false };
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    console.log("[SimplyHired] Timed out after " + Math.round(maxWaitMs / 1000) + "s.");
    return {
      cleared: false,
      sawCaptchaOnce: sawCaptchaOnce,
      jobs: countJobLinks(),
      noResults: isNoResultsPage(),
    };
  }

  function scrapeCurrentPage() {
    const links = document.querySelectorAll('a[href*="/job/"]');
    console.log(`[SimplyHired] Found ${links.length} job links`);

    let added = 0;
    links.forEach((link) => {
      let url = link.href;
      if (url.startsWith("/")) url = "https://" + window.location.hostname + url;
      if (allJobs.has(url)) return;

      let container =
        link.closest('div[class*="chakra-stack"]') ||
        link.closest("div, li, article, section");
      if (!container) container = link.parentElement;
      if (container && container.children.length === 1 && container.children[0] === link) {
        container = container.parentElement;
      }
      if (!container) return;

      const title = link.textContent.trim();

      let company = "Unknown";
      const companyEl = container.querySelector(
        '[data-testid="company-name"], .company-name, .employer, [class*="company"], [class*="employer"]',
      );
      if (companyEl) {
        company = companyEl.textContent.trim();
      } else {
        const textParts = container.textContent
          .split(/[•|,|\n]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (textParts.length > 1) {
          const atIndex = textParts.findIndex((p) => p.includes(" at "));
          if (atIndex !== -1) {
            const parts = textParts[atIndex].split(" at ");
            if (parts.length > 1) company = parts[1].trim();
          } else {
            company = textParts[1] || "Unknown";
          }
        }
      }

      let location = "Remote";
      const locationEl = container.querySelector(
        '[data-testid="job-location"], .job-location, .location, [class*="location"]',
      );
      if (locationEl) {
        location = locationEl.textContent.trim();
      } else {
        const match = container.textContent.match(
          /\b(Remote|Hybrid|On-site|Onsite|USA|United States|UK|Canada|[\w\s]+,\s*[A-Z]{2})\b/,
        );
        if (match) location = match[0];
      }

      const salaryEl = container.querySelector(
        '[data-testid="salary"], .salary, [class*="salary"]',
      );
      const salary = salaryEl ? salaryEl.textContent.trim() : "";

      allJobs.set(url, { title, company, location, salary, url, source: "simplyhired" });
      added++;
    });

    console.log(`[SimplyHired] Extracted ${added} unique jobs`);
    return added;
  }

  function getNextPageUrl() {
    const selectors = [
      'nav[aria-label="Pagination"]', ".pagination", '[class*="pagination"]',
      'div[role="navigation"]', 'ul[class*="pagination"]',
    ];
    let container = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { container = el; break; }
    }
    if (!container) return findNextOnWholePage();

    const candidates = container.querySelectorAll("a, button, span");
    for (const el of candidates) {
      const text = el.textContent.toLowerCase().trim();
      const ariaLabel = el.getAttribute("aria-label") || "";
      const href = el.href || "";
      if (href.includes("/job/")) continue;
      if (text.includes("next") || text.includes("›") || text.includes("»") ||
          ariaLabel.toLowerCase().includes("next")) {
        if (el.hasAttribute("aria-disabled") && el.getAttribute("aria-disabled") === "true") return null;
        if (el.classList && el.classList.contains("disabled")) return null;
        if (href) {
          let nextUrl = href;
          if (nextUrl.startsWith("/")) nextUrl = "https://" + window.location.hostname + nextUrl;
          return nextUrl;
        }
      }
    }

    const nextLink = container.querySelector('a[rel="next"], a[aria-label="Next"]');
    if (nextLink && nextLink.href && !nextLink.href.includes("/job/")) {
      let nextUrl = nextLink.href;
      if (nextUrl.startsWith("/")) nextUrl = "https://" + window.location.hostname + nextUrl;
      return nextUrl;
    }
    return findNextOnWholePage();
  }

  function findNextOnWholePage() {
    const all = document.querySelectorAll("a, button");
    for (const el of all) {
      const text = el.textContent.toLowerCase().trim();
      const ariaLabel = el.getAttribute("aria-label") || "";
      const href = el.href || "";
      if (href.includes("/job/")) continue;
      if (text.includes("next") || text.includes("›") || text.includes("»") ||
          ariaLabel.toLowerCase().includes("next")) {
        if (el.hasAttribute("aria-disabled") && el.getAttribute("aria-disabled") === "true") return null;
        if (el.classList && el.classList.contains("disabled")) return null;
        if (href) {
          let nextUrl = href;
          if (nextUrl.startsWith("/")) nextUrl = "https://" + window.location.hostname + nextUrl;
          return nextUrl;
        }
      }
    }
    return null;
  }

  function saveJobs() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(allJobs.values())));
  }

  function uploadAndCleanup() {
    const jobsList = Array.from(allJobs.values());

    if (DEBUG) {
      console.log(`[SimplyHired] Final: ${jobsList.length} jobs`);
      localStorage.removeItem(STORAGE_KEY);
      return;
    }

    GM_xmlhttpRequest({
      method: "POST",
      url: "http://localhost:3000/api/simplyhired/upload-json",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        Cookie: "simplyhired_cookie_consent=%7B%22strictly_necessary%22%3Atrue%2C%22functionality%22%3Atrue%2C%22targeting%22%3Atrue%7D",
      },
      data: JSON.stringify({ scrapeIdx: scrapeIdx, jobs: jobsList }),
      onload: () => {
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem("simplyhired_scrape_idx");
        sessionStorage.removeItem("simplyhired_page_counter");
        sessionStorage.removeItem("simplyhired_original_url");
        window.close();
      },
      onerror: (err) => {
        console.error("[SimplyHired] Upload failed", err);
        try { window.close(); } catch (e) {}
      },
    });
  }

  function safeClose() {
    try { window.close(); } catch (e) {}
  }

  async function runScraper() {
    console.log("[SimplyHired] v3.1 starting:", window.location.href.substring(0, 100));

    // ── Homepage with possible captcha ──
    if (isHomepage()) {
      console.log("[SimplyHired] Homepage URL.");
      if (isCaptchaPresent() || !document.body.innerText) {
        var hr = await waitForCaptchaAndContent(60000, "homepage captcha");
        if (hr.homepage) { safeClose(); return; }
        if (!hr.cleared) { safeClose(); return; }
      }
      if (isHomepage()) {
        console.log("[SimplyHired] Still homepage, no jobs. Closing.");
        safeClose();
        return;
      }
    }

    // ── Observation window ──
    var observationStart = Date.now();
    var sawCaptcha = false;
    var lastLog = 0;

    console.log("[SimplyHired] Entering observation (up to 20s)...");
    while (Date.now() - observationStart < 20000) {
      if (Date.now() - lastLog > 3000) {
        console.log(
          "[SimplyHired] Observing: captcha=" + isCaptchaPresent() +
          " jobs=" + countJobLinks() +
          " noResults=" + isNoResultsPage()
        );
        lastLog = Date.now();
      }
      if (isCaptchaPresent()) { sawCaptcha = true; break; }
      if (countJobLinks() > 0) { console.log("[SimplyHired] Jobs found."); break; }
      if (isNoResultsPage()) {
        console.log("[SimplyHired] No-results. Bailing.");
        uploadAndCleanup();
        sessionStorage.removeItem("simplyhired_page_counter");
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }

    // ── Captcha branch ──
    if (sawCaptcha) {
      var r = await waitForCaptchaAndContent(60000, "search page captcha");
      if (r.homepage) {
        console.log("[SimplyHired] Homepage after captcha. Closing.");
        safeClose();
        return;
      }
      if (!r.cleared) {
        console.log("[SimplyHired] Captcha never cleared. Bailing.");
        uploadAndCleanup();
        return;
      }
      if (r.noResults) {
        console.log("[SimplyHired] No-results after captcha. Bailing.");
        uploadAndCleanup();
        sessionStorage.removeItem("simplyhired_page_counter");
        return;
      }
      if (r.jobs === 0) {
        console.log("[SimplyHired] Cleared but no jobs. Bailing.");
        uploadAndCleanup();
        return;
      }
    }

    // ── Final sanity check ──
    if (countJobLinks() === 0 && !isNoResultsPage()) {
      console.log("[SimplyHired] No content. Bailing.");
      uploadAndCleanup();
      return;
    }
    if (isNoResultsPage()) {
      console.log("[SimplyHired] No-results (final). Bailing.");
      uploadAndCleanup();
      sessionStorage.removeItem("simplyhired_page_counter");
      return;
    }

    // ── Dismiss banners ──
    const dismissBtns = document.querySelectorAll('button, a[role="button"]');
    dismissBtns.forEach((btn) => {
      const txt = btn.textContent.toLowerCase();
      if (txt.includes("accept") || txt.includes("agree") || txt.includes("close") ||
          txt.includes("got it") || txt.includes("continue") || txt.includes("ok")) {
        btn.click();
      }
    });
    await new Promise((r) => setTimeout(r, 1000));

    // ── Scrape ──
    const added = scrapeCurrentPage();

    let pageCount = parseInt(
      sessionStorage.getItem("simplyhired_page_counter") || "1",
      10,
    );
    console.log(`[SimplyHired] Page ${pageCount} (idx=${scrapeIdx}): +${added} jobs (total ${allJobs.size})`);
    saveJobs();

    if (pageCount >= MAX_PAGES) {
      uploadAndCleanup();
      sessionStorage.removeItem("simplyhired_page_counter");
      return;
    }

    const nextUrl = getNextPageUrl();
    if (!nextUrl) {
      uploadAndCleanup();
      sessionStorage.removeItem("simplyhired_page_counter");
      return;
    }

    pageCount++;
    sessionStorage.setItem("simplyhired_page_counter", pageCount);
    console.log(`[SimplyHired] → page ${pageCount}`);
    saveJobs();
    setTimeout(() => { window.location.href = nextUrl; }, 2000);
  }

  runScraper();
})();