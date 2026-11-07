// ==UserScript==
// @name         Glassdoor Auto-Scraper (Crash-Proof Native Scroll)
// @namespace    http://localhost:3000/
// @version      3.5
// @description  Scrapes Glassdoor safely. Hides modals instead of deleting them to prevent React engine crashes.
// @author       JobScraper
// @match        https://*.glassdoor.com/Job/*
// @match        https://*.glassdoor.com/job/*
// @match        https://*.glassdoor.co.uk/Job/*
// @match        https://*.glassdoor.co.uk/job/*
// @match        https://www.glassdoor.com/Job/index.htm*
// @include      /^https?:\/\/[^\/]*glassdoor\.[a-z.]+\/.*(SRCH_|sc\.keyword=)/
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        window.close
// @connect      localhost
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  var BACKEND_URL = "http://localhost:3000/api/glassdoor/upload-json";
  var INITIAL_DELAY_MS = 5000;
  var CAPTCHA_CHECK_INTERVAL_MS = 3000;
  var HARD_CAP_MS = 20000;
  var SCRAPE_START = Date.now();

  function getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }

    // Synthetic Enter key with proper keyCode/which. The KeyboardEvent
  // constructor leaves keyCode/which at 0 (they're read-only on the
  // prototype), and most React form handlers check e.keyCode === 13.
  function dispatchRealEnter(input) {
    var ev = new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    try {
      Object.defineProperty(ev, "keyCode", { get: function () { return 13; } });
      Object.defineProperty(ev, "which",   { get: function () { return 13; } });
    } catch (e) {}
    input.dispatchEvent(ev);

    var ev2 = new KeyboardEvent("keypress", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    try {
      Object.defineProperty(ev2, "keyCode", { get: function () { return 13; } });
      Object.defineProperty(ev2, "which",   { get: function () { return 13; } });
    } catch (e) {}
    input.dispatchEvent(ev2);

    var ev3 = new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true,
    });
    try {
      Object.defineProperty(ev3, "keyCode", { get: function () { return 13; } });
      Object.defineProperty(ev3, "which",   { get: function () { return 13; } });
    } catch (e) {}
    input.dispatchEvent(ev3);
  }

  function getQueryParam(param) {
    var params = new URLSearchParams(window.location.search);
    return params.get(param);
  }

  // ── SEED PARAM HANDLING ──
  var seedLocFromUrl = getQueryParam("gd_seed_location");
  var seedKwFromUrl = getQueryParam("gd_seed_keyword");
  if (seedLocFromUrl) {
    sessionStorage.setItem("gd_seed_location", seedLocFromUrl);
    sessionStorage.setItem("gd_seed_keyword", seedKwFromUrl || "");
    sessionStorage.setItem("gd_seed_pending", "1");
  }

  var idxFromUrl = getQueryParam("scrape_idx");
  var SCRAPE_IDX;
  if (idxFromUrl !== null && !isNaN(parseInt(idxFromUrl, 10))) {
    SCRAPE_IDX = parseInt(idxFromUrl, 10);
    sessionStorage.setItem("gd_scrape_idx", String(SCRAPE_IDX));
  } else {
    var storedIdx = sessionStorage.getItem("gd_scrape_idx");
    SCRAPE_IDX = storedIdx !== null ? parseInt(storedIdx, 10) : 0;
    if (isNaN(SCRAPE_IDX)) SCRAPE_IDX = 0;
  }
  console.log(
    "[GlassdoorScraper] scrape_idx = " +
      SCRAPE_IDX +
      " (fromUrl=" +
      idxFromUrl +
      ")",
  );

  var hasSeededLocation = false;
  var hasStarted = false;
  var isSending = false;

  // ── CSS OVERRIDE ──
  function injectCssDestroyer() {
    if (document.getElementById("gd-modal-destroyer")) return;
    var style = document.createElement("style");
    style.id = "gd-modal-destroyer";
    style.innerHTML = `
      body, html { overflow: auto !important; position: static !important; height: auto !important; }
      div[class*="modal" i], section[class*="modal" i], dialog, [role="dialog"],
      div[class*="toast" i], div[class*="Toast" i], div[class*="notification" i],
      div[class*="alert" i], div[id*="onetrust" i], div[class*="cookie" i],
      div[class*="qualification" i], div[class*="Qualification" i],
      [class*="backdrop" i], [class*="overlay" i], [class*="Overlay" i],
      #onetrust-consent-sdk {
        display: none !important; opacity: 0 !important;
        pointer-events: none !important; visibility: hidden !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function dismissModals() {
    var modals = document.querySelectorAll(
      'div[class*="modal" i], section[class*="modal" i], dialog, [role="dialog"]',
    );
    modals.forEach(function (modal) {
      var closeBtn = modal.querySelector(
        'button[aria-label="Close"], button[class*="close" i], button[class*="Close" i], button[data-test="modal-close"]',
      );
      if (closeBtn) {
        closeBtn.click();
      } else {
        modal.style.setProperty("display", "none", "important");
        modal.style.setProperty("pointer-events", "none", "important");
      }
    });
    var overlays = document.querySelectorAll(
      '[class*="backdrop" i], [class*="overlay" i], [class*="Overlay" i], [class*="toast" i], [class*="Toast" i], [class*="notification" i], [class*="alert" i], #onetrust-consent-sdk, .ot-sdk-container',
    );
    overlays.forEach(function (el) {
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("pointer-events", "none", "important");
      el.style.setProperty("opacity", "0", "important");
    });
  }

  injectCssDestroyer();
  setInterval(function () {
    injectCssDestroyer();
    dismissModals();
  }, 800);

  function isBlocked() {
    var bodyText = document.body ? document.body.innerText || "" : "";
    var checks = [
      /are you a robot/i,
      /verify you are human/i,
      /cloudflare/i,
      /ddos protection/i,
    ];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i].test(bodyText)) return true;
    }
    return false;
  }

  // ── NO-RESULTS DETECTOR ──
  function isNoResultsPage() {
    var bodyText = document.body
      ? (document.body.innerText || "").toLowerCase()
      : "";
    var phrases = [
      "no jobs found",
      "no results found",
      "no matching jobs",
      "did not match any jobs",
      "no jobs match your search",
      "keine jobs gefunden",
      "keine ergebnisse",
      "aucun emploi",
      "aucun résultat",
      "aucun resultat",
      "no se encontraron",
      "sin resultados",
      "nessun lavoro trovato",
      "nessun risultato",
      "geen vacatures",
      "geen resultaten",
      "brak wyników",
      "brak ofert",
      "nem található",
      "nincs találat",
      "δεν βρέθηκαν",
      "κανένα αποτέλεσμα",
      "ingen jobb",
      "inga resultat",
      "ingen job",
      "ingen resultater",
      "ei töitä",
      "ei tuloksia",
      "ingen träffar",
      "inga träffar",
    ];
    for (var i = 0; i < phrases.length; i++) {
      if (bodyText.indexOf(phrases[i]) !== -1) return true;
    }
    var emptyState = document.querySelector(
      '[data-test="no-results"], [data-test="empty-state"], [data-test="no-jobs"], ' +
        '[class*="NoResults" i], [class*="EmptyState" i], [class*="NoJobsFound" i], ' +
        '[class*="NoJobs" i], [class*="EmptySearch" i]',
    );
    if (emptyState && emptyState.offsetWidth > 0 && emptyState.offsetHeight > 0)
      return true;
    return false;
  }

  // ── COMMUNITY / HOMEPAGE BAIL-OUT ──
  function isWrongPage() {
    var host = window.location.hostname;
    var path = window.location.pathname;

    if (
      host === "community.glassdoor.com" ||
      host === "help.glassdoor.com" ||
      host === "employers.glassdoor.com"
    )
      return true;
    if (path === "/" || path === "/index.htm" || path === "/index.html")
      return true;

    var url = window.location.href;
    if (
      url.indexOf("SRCH_") === -1 &&
      url.indexOf("sc.keyword=") === -1 &&
      url.indexOf("sc.location=") === -1
    )
      return true;
    return false;
  }

  // ── URL FILTER ENFORCER ──
  function enforceUrlFilters() {
    var urlObj = new URL(window.location.href);
    var params = urlObj.searchParams;
    var changed = false;
    if (params.get("fromAge") !== "1") {
      params.set("fromAge", "1");
      changed = true;
    }
    if (params.get("sortBy") !== "date_desc") {
      params.set("sortBy", "date_desc");
      changed = true;
    }
    if (params.get("remoteWorkType") !== "1") {
      params.set("remoteWorkType", "1");
      changed = true;
    }
    if (!params.has("scrape_idx")) {
      params.set("scrape_idx", SCRAPE_IDX.toString());
      changed = true;
    }
    if (changed) {
      window.location.replace(urlObj.toString());
      return true;
    }
    return false;
  }

  function getJobCards() {
    return document.querySelectorAll(
      '[data-test="job-listing"], [class*="JobCard_jobCardContainer"], li[class*="JobsList_jobListItem"]',
    );
  }

  function scrapePage() {
    var jobs = [];
    var cards = getJobCards();
    cards.forEach(function (card) {
      var titleEl = card.querySelector(
        '[data-test="job-title"], [class*="jobTitle"], a[class*="jobLink"]',
      );
      var companyEl = card.querySelector(
        '[data-test="employer-short-name"], [class*="employerName"]',
      );
      var locationEl = card.querySelector(
        '[data-test="emp-location"], [class*="location"]',
      );
      var linkEl = card.querySelector(
        'a[data-test="job-link"], a[class*="jobLink"], a[class*="JobCard_trackingLink"]',
      );
      var salaryEl = card.querySelector(
        '[data-test="detailSalary"], [class*="salaryEstimate"]',
      );
      if (titleEl) {
        jobs.push({
          title: titleEl.innerText.trim(),
          company: companyEl ? companyEl.innerText.trim() : "",
          location: locationEl ? locationEl.innerText.trim() : "",
          url: linkEl ? linkEl.href : window.location.href,
          salary: salaryEl ? salaryEl.innerText.trim() : "",
          scraped_at: new Date().toISOString(),
        });
      }
    });
    return jobs;
  }

  function sendAndClose() {
    if (isSending) return;
    isSending = true;
    var jobs = scrapePage();
    var payload = { scrapeIdx: SCRAPE_IDX, platform: "glassdoor", jobs: jobs };
    console.log(
      "[GlassdoorScraper] Scraping complete. Total: " +
        jobs.length +
        " jobs. Sending...",
    );
    GM_xmlhttpRequest({
      method: "POST",
      url: BACKEND_URL,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      onload: function () {
        console.log(
          "[GlassdoorScraper] Backend accepted payload. Closing tab.",
        );
        try {
          GM_setValue("gd_current_idx", 0);
        } catch (e) {}
        setTimeout(function () {
          window.close();
        }, 1500);
      },
      onerror: function () {
        console.error("[GlassdoorScraper] Post failed. Closing tab anyway.");
        setTimeout(function () {
          window.close();
        }, 1500);
      },
    });
  }

  var lastJobCount = 0;
  var noChangeAttempts = 0;

  async function runScraperLoop() {
    if (Date.now() - SCRAPE_START > HARD_CAP_MS) {
      console.log("[GlassdoorScraper] Hard cap hit. Sending what we have.");
      sendAndClose();
      return;
    }
    if (isWrongPage()) {
      console.log(
        "[GlassdoorScraper] Wrong page detected (" +
          window.location.href +
          "). Sending empty and closing.",
      );
      sendAndClose();
      return;
    }
    if (isNoResultsPage()) {
      console.log(
        "[GlassdoorScraper] No-results page detected. Sending empty and closing.",
      );
      sendAndClose();
      return;
    }
    if (isBlocked()) {
      setTimeout(runScraperLoop, CAPTCHA_CHECK_INTERVAL_MS);
      return;
    }
    var cards = getJobCards();
    var currentJobCount = cards.length;
    console.log("[GlassdoorScraper] Current visible jobs: " + currentJobCount);

    if (currentJobCount === 0 && lastJobCount === 0) {
      noChangeAttempts++;
      if (noChangeAttempts >= 2) {
        console.log(
          "[GlassdoorScraper] No jobs rendered. Sending empty and closing.",
        );
        sendAndClose();
        return;
      }
    } else if (currentJobCount > 0 && currentJobCount === lastJobCount) {
      noChangeAttempts++;
      if (noChangeAttempts >= 3) {
        console.log(
          "[GlassdoorScraper] Job count flatlined. End of list reached.",
        );
        sendAndClose();
        return;
      }
    } else {
      noChangeAttempts = 0;
      lastJobCount = currentJobCount;
    }

    if (cards.length > 0) {
      var lastCard = cards[cards.length - 1];
      console.log("[GlassdoorScraper] Gliding down to last card smoothly...");
      lastCard.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    await new Promise(function (r) {
      setTimeout(r, getRandomDelay(1500, 2500));
    });

    var showMoreBtn = document.querySelector(
      'button[data-test="load-more-jobs"], button[class*="ShowMoreButton"]',
    );
    if (!showMoreBtn) {
      var buttons = document.querySelectorAll("button");
      for (var i = 0; i < buttons.length; i++) {
        var text = (buttons[i].innerText || "").toLowerCase().trim();
        if (
          (text === "show more" ||
            text === "load more" ||
            text === "show more jobs" ||
            text === "load more jobs") &&
          (buttons[i].offsetWidth > 0 || buttons[i].offsetHeight > 0)
        ) {
          showMoreBtn = buttons[i];
          break;
        }
      }
    }

    if (showMoreBtn) {
      console.log('[GlassdoorScraper] Moving to "Show More" button...');
      showMoreBtn.scrollIntoView({ block: "center", behavior: "smooth" });
      await new Promise(function (r) {
        setTimeout(r, getRandomDelay(1200, 2200));
      });
      showMoreBtn.click();
      setTimeout(runScraperLoop, getRandomDelay(4000, 6000));
    } else {
      console.log('[GlassdoorScraper] No "Show More" button found. Finished.');
      sendAndClose();
    }
  }

  function findKeywordInput() {
    var selectors = [
      'input[placeholder*="perfect job" i]',
      'input[placeholder*="Job title" i]',
      'input[placeholder*="job title" i]',
      'input[placeholder*="keyword" i]',
      'input[placeholder*="search job" i]',
      'input[aria-label*="keyword" i]',
      'input[aria-label*="job title" i]',
      'input[name="sc.keyword"]',
      'input[name*="keyword" i]',
      'input[id*="keyword" i]',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) continue;
      var ph = (el.placeholder || "").toLowerCase();
      if (ph.indexOf("city") !== -1 || ph.indexOf("location") !== -1) continue;
      return el;
    }
    return null;
  }

  function findLocationInput() {
    var selectors = [
      'input[placeholder*="City, state" i]',
      'input[placeholder*="zipcode" i]',
      'input[placeholder*="remote" i]',
      'input[aria-label*="location" i]',
      'input[data-test*="location" i]',
      'input[name*="location" i]',
      'input[id*="location" i]',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return el;
    }
    return null;
  }

    function findSearchButton() {
    // Ordered by how specific the match is.
    var selectors = [
      'button[data-test="search-button"]',
      'button[data-test*="search" i]',
      'button[type="submit"]',
      'button[aria-label="Search"]',
      'button[aria-label*="search" i]',
      'button[title*="search" i]',
      // Icon-button fallback: any button containing an svg with id/class about search.
      'button:has(svg[data-test*="search" i])',
      'button:has(svg[id*="search" i])',
      'button:has(svg[class*="search" i])',
    ];
    for (var i = 0; i < selectors.length; i++) {
      var list;
      try { list = document.querySelectorAll(selectors[i]); }
      catch (e) { list = []; }
      for (var j = 0; j < list.length; j++) {
        var el = list[j];
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return el;
      }
    }
    return null;
  }

  function fillReactInput(input, value) {
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus();
  }

  // Character-by-character typing. React's autocomplete components track
  // every keystroke, so a one-shot .value assignment often gets wiped on
  // the next re-render. Typing char-by-char produces a value React trusts.
  async function typeIntoReactInput(input, value) {
    if (!input) return false;
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set;

    // Clear first.
    input.focus();
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(function (r) {
      setTimeout(r, 150);
    });

    for (var i = 0; i < value.length; i++) {
      var ch = value[i];
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, bubbles: true }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keypress", { key: ch, bubbles: true }),
      );
      setter.call(input, input.value + ch);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent("keyup", { key: ch, bubbles: true }),
      );
      await new Promise(function (r) {
        setTimeout(r, 40 + Math.random() * 50);
      });
    }
    return input.value.length > 0;
  }

  function findFirstSuggestion(matchText) {
    var selector =
      '[role="listbox"] li, [role="option"], ' +
      'ul[class*="suggestion" i] li, ' +
      'div[class*="autocomplete" i] li, ' +
      'div[class*="typeahead" i] li, ' +
      'div[class*="dropdown" i] li, ' +
      'li[data-test*="suggestion" i], li[data-test*="location" i], ' +
      '[class*="Autocomplete" i] li, [class*="Suggestions" i] > *';
    var items = document.querySelectorAll(selector);
    var lower = matchText.toLowerCase();
    for (var i = 0; i < items.length; i++) {
      var text = (items[i].innerText || "").trim().toLowerCase();
      if (text.indexOf(lower) !== -1) return items[i];
    }
    return null;
  }

  async function seedLocationThenProceed() {
    var location = sessionStorage.getItem("gd_seed_location");
    var keyword = sessionStorage.getItem("gd_seed_keyword") || "";
    console.log(
      "[GlassdoorScraper] Seeding location='" +
        location +
        "' keyword='" +
        keyword +
        "'",
    );

    function sleep(ms) {
      return new Promise(function (r) {
        setTimeout(r, ms);
      });
    }

    // ── Phase 1: wait for both inputs to appear ──
    var locInput = null,
      kwInput = null;
    for (var attempt = 0; attempt < 40; attempt++) {
      locInput = findLocationInput();
      kwInput = findKeywordInput();
      if (locInput && kwInput) break;
      await sleep(500);
    }
    if (!locInput || !kwInput) {
      console.warn("[GlassdoorScraper] Inputs never appeared. Bailing.");
      sessionStorage.removeItem("gd_seed_pending");
      sendAndClose();
      return;
    }

    // ── Phase 2: wait for React hydration to finish ──
    // Without this, hydration re-renders the inputs and wipes our fill.
    console.log("[GlassdoorScraper] Inputs found. Waiting 3s for hydration...");
    await sleep(3000);

    // Re-query — hydration often swaps the element instances.
    locInput = findLocationInput();
    kwInput = findKeywordInput();
    if (!locInput || !kwInput) {
      console.warn(
        "[GlassdoorScraper] Inputs vanished after hydration wait. Bailing.",
      );
      sessionStorage.removeItem("gd_seed_pending");
      sendAndClose();
      return;
    }

    // ── Phase 3: type location, verify, retry up to 3x ──
    var locOk = false;
    for (var locTry = 0; locTry < 3 && !locOk; locTry++) {
      console.log("[GlassdoorScraper] Location typing attempt " + (locTry + 1));
      await typeIntoReactInput(locInput, location);
      await sleep(1800);

      if (locInput.value && locInput.value.trim().length > 0) {
        locOk = true;
      } else {
        console.warn(
          "[GlassdoorScraper] Location cleared after typing. Retrying...",
        );
        locInput = findLocationInput();
        if (!locInput) break;
        await sleep(800);
      }
    }
    if (!locOk) {
      console.warn(
        "[GlassdoorScraper] Could not keep location value. Bailing.",
      );
      sessionStorage.removeItem("gd_seed_pending");
      sendAndClose();
      return;
    }

    // ── Phase 4: pick the autocomplete suggestion ──
    // Give the dropdown a moment to render after typing.
    await sleep(1500);
    var suggestion = findFirstSuggestion(location);
    if (suggestion) {
      console.log("[GlassdoorScraper] Clicking location suggestion.");
      suggestion.click();
      await sleep(800);
    } else {
      console.log("[GlassdoorScraper] No suggestion found; keeping raw text.");
    }

    // ── Phase 5: type keyword, verify, retry ──
    kwInput = findKeywordInput();
    if (!kwInput) {
      console.warn("[GlassdoorScraper] Keyword input vanished. Bailing.");
      sessionStorage.removeItem("gd_seed_pending");
      sendAndClose();
      return;
    }

    var kwOk = false;
    for (var kwTry = 0; kwTry < 3 && !kwOk; kwTry++) {
      await typeIntoReactInput(kwInput, keyword);
      await sleep(1200);
      if (kwInput.value && kwInput.value.trim().length > 0) {
        kwOk = true;
      } else {
        kwInput = findKeywordInput();
        if (!kwInput) break;
        await sleep(800);
      }
    }
    if (!kwOk) {
      console.warn("[GlassdoorScraper] Could not keep keyword value. Bailing.");
      sessionStorage.removeItem("gd_seed_pending");
      sendAndClose();
      return;
    }

       // ── Phase 6: submit (multi-strategy) ──
    console.log("[GlassdoorScraper] Submitting search.");
    var initialHref = window.location.href;

    // Strategy 1: real Enter key on the keyword input.
    kwInput.focus();
    dispatchRealEnter(kwInput);
    await sleep(800);
    if (window.location.href !== initialHref) {
      console.log("[GlassdoorScraper] Navigated via Enter (keyword).");
    } else {
      // Strategy 2: real Enter on the location input.
      console.log("[GlassdoorScraper] Enter on keyword didn't navigate. Trying location input.");
      var locNow = findLocationInput();
      if (locNow) {
        locNow.focus();
        dispatchRealEnter(locNow);
        await sleep(800);
      }
      if (window.location.href !== initialHref) {
        console.log("[GlassdoorScraper] Navigated via Enter (location).");
      } else {
        // Strategy 3: submit the enclosing <form> directly.
        console.log("[GlassdoorScraper] Enter didn't navigate. Trying form.submit().");
        var form = kwInput.closest("form");
        if (form) {
          try {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          } catch (e) {}
          try { form.submit(); } catch (e) {}
          await sleep(1000);
        }
        if (window.location.href !== initialHref) {
          console.log("[GlassdoorScraper] Navigated via form submit.");
        } else {
          // Strategy 4: hunt for a search button near the inputs.
          console.log("[GlassdoorScraper] Form submit didn't navigate. Hunting for a search button.");
          var searchBtn = findSearchButton();
          if (searchBtn) {
            console.log("[GlassdoorScraper] Clicking button: " + (searchBtn.getAttribute("aria-label") || searchBtn.className || "unnamed"));
            searchBtn.click();
          } else {
            console.warn("[GlassdoorScraper] No search button found anywhere.");
          }
        }
      }
    }

    // ── Phase 7: wait for navigation to the slug URL ──
    await sleep(10000);

    var href = window.location.href;
    if (href.indexOf("_IC") === -1 && href.indexOf("SRCH_") === -1) {
      console.warn(
        "[GlassdoorScraper] Seeding did not navigate to a results URL. Bailing.",
      );
      sessionStorage.removeItem("gd_seed_pending");
      sendAndClose();
    }
    // If it did navigate, MutationObserver re-runs initScraper on the new URL.
  }

  function initScraper() {
    if (hasStarted) {
      console.log(
        "[GlassdoorScraper] Already started — ignoring duplicate init.",
      );
      return;
    }

    var seedPending = sessionStorage.getItem("gd_seed_pending") === "1";
    var href = window.location.href;
    var onResultsPage =
      href.indexOf("_IC") !== -1 || href.indexOf("SRCH_") !== -1;

    if (seedPending && onResultsPage) {
      sessionStorage.removeItem("gd_seed_pending");
      sessionStorage.removeItem("gd_seed_location");
      sessionStorage.removeItem("gd_seed_keyword");
    }

    if (seedPending && !onResultsPage && !hasSeededLocation) {
      hasSeededLocation = true;
      seedLocationThenProceed();
      return;
    }

    if (isWrongPage()) {
      console.log(
        "[GlassdoorScraper] Wrong page on load (" +
          window.location.href +
          "). Sending empty and closing.",
      );
      sendAndClose();
      return;
    }

    if (isNoResultsPage()) {
      console.log(
        "[GlassdoorScraper] No-results page on load. Sending empty and closing.",
      );
      sendAndClose();
      return;
    }

    if (enforceUrlFilters()) return;

    hasStarted = true;
    var waitTime = getRandomDelay(4000, 6000);
    console.log(
      "[GlassdoorScraper] Filters verified. Starting in " +
        waitTime / 1000 +
        "s...",
    );
    setTimeout(function () {
      runScraperLoop();
    }, waitTime);
  }

  if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  ) {
    initScraper();
  } else {
    window.addEventListener("DOMContentLoaded", initScraper);
  }
})();
