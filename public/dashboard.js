(function () {
  "use strict";

  var VALID_STATUSES = [
    "Select Status",
    "Applied",
    "Interviewing",
    "Offered",
    "Rejected",
    "Archived",
    "Duplicate",
    "Manual Review",
    "Skipped",
  ];

  var currentJobs = [];
  var savedPage = parseInt(sessionStorage.getItem("currentPage"), 10);
  var currentPage = savedPage > 0 ? savedPage : 1;
  var currentLimit = 100;
  var currentTotal = 0;

  var _savedStatus = localStorage.getItem("filterStatus");
  if (!_savedStatus || _savedStatus === "Select Status") _savedStatus = "all";
  var filters = {
    date: localStorage.getItem("filterDate") || "all",
    type: localStorage.getItem("filterType") || "all",
    status: _savedStatus,
    tier: localStorage.getItem("filterTier") || "ALL",
    source: localStorage.getItem("filterSource") || "all",
  };

  function saveFilters() {
    localStorage.setItem("filterDate", filters.date);
    localStorage.setItem("filterType", filters.type);
    localStorage.setItem("filterStatus", filters.status);
    localStorage.setItem("filterTier", filters.tier);
    localStorage.setItem("filterSource", filters.source);
  }

  // ── SOURCE FILTER DEFINITIONS ──
  // Values are matched case-insensitively against the DB `source` field.
  // If a chip returns zero results, check the actual `source` string in
  // MongoDB — some aggregators may store a slightly different slug.
  var SOURCE_AGGREGATORS = [
    { value: "adzuna", label: "Adzuna" },
    { value: "jooble", label: "Jooble" },
    { value: "careerjet", label: "Careerjet" },
    { value: "reed", label: "Reed" },
    { value: "serpapi", label: "SerpApi" },
    { value: "theirstack", label: "TheirStack" },
    { value: "serper", label: "Serper" },
    { value: "arbeitnow", label: "Arbeitnow" },
    { value: "aidevjobs", label: "AiDevJobs" },
    { value: "jobdatalake", label: "JobDataLake" },
    { value: "whatjobs", label: "WhatJobs" },
    { value: "findwork", label: "Findwork" },
    { value: "jobicy", label: "Jobicy" },
    { value: "jsearch", label: "JSearch" },
    { value: "remoteok", label: "RemoteOK" },
    { value: "remotive", label: "Remotive" },
    { value: "himalayas", label: "Himalayas" },
    { value: "4dayweek", label: "4dayweek.io" },
    { value: "ycombinator", label: "YCombinator" },
    { value: "nofluffjobs", label: "NoFluffJobs" },
    { value: "weworkremotely", label: "WeWorkRemotely" },
  ];

  var SOURCE_PREMIUM = [
    { value: "linkedin", label: "LinkedIn" },
    { value: "indeed", label: "Indeed" },
    { value: "dice", label: "Dice" },
    { value: "glassdoor", label: "Glassdoor" },
    { value: "simplyhired", label: "SimplyHired" },
  ];

  function renderSourcePills() {
    var aggEl = document.getElementById("pills-source-agg");
    var premEl = document.getElementById("pills-source-prem");
    if (!aggEl || !premEl) return;

    var activeSet = {};
    var allActive = !filters.source || filters.source === "all";
    if (!allActive) {
      filters.source.split(",").forEach(function (s) {
        activeSet[s] = true;
      });
    }

    var htmlAgg =
      '<span class="pill' +
      (allActive ? " active" : "") +
      '" data-val="all" data-key="source">All</span>';
    for (var i = 0; i < SOURCE_AGGREGATORS.length; i++) {
      var o = SOURCE_AGGREGATORS[i];
      htmlAgg +=
        '<span class="pill' +
        (activeSet[o.value] ? " active" : "") +
        '" data-val="' +
        o.value +
        '" data-key="source">' +
        o.label +
        "</span>";
    }
    aggEl.innerHTML = htmlAgg;

    var htmlPrem = "";
    for (var j = 0; j < SOURCE_PREMIUM.length; j++) {
      var p = SOURCE_PREMIUM[j];
      htmlPrem +=
        '<span class="pill' +
        (activeSet[p.value] ? " active" : "") +
        '" data-val="' +
        p.value +
        '" data-key="source">' +
        p.label +
        "</span>";
    }
    premEl.innerHTML = htmlPrem;
  }

  function renderPills(containerId, options, selected, key) {
    var el = document.getElementById(containerId);
    var html = "";
    for (var i = 0; i < options.length; i++) {
      var o = options[i];
      html +=
        '<span class="pill' +
        (o.value === selected ? " active" : "") +
        '" data-val="' +
        o.value +
        '" data-key="' +
        key +
        '">' +
        o.label +
        "</span>";
    }
    el.innerHTML = html;
  }

  function initPills() {
    var dateOpts = [
      { value: "today", label: "Today" },
      { value: "1d", label: "1 Day" },
      { value: "3d", label: "3 Days" },
      { value: "1w", label: "1 Week" },
      { value: "all", label: "All" },
    ];
    var typeOpts = [
      { value: "Remote", label: "Remote" },
      { value: "Hybrid", label: "Hybrid" },
      { value: "On-site", label: "On-site" },
      { value: "all", label: "All" },
    ];
    var statOpts = [
      { value: "Pending", label: "Pending" },
      { value: "Manual Review", label: "Manual Review" },
      { value: "Applied", label: "Applied" },
      { value: "Interviewing", label: "Interviewing" },
      { value: "Offered", label: "Offered" },
      { value: "Rejected", label: "Rejected" },
      { value: "Archived", label: "Archived" },
      { value: "all", label: "All" },
    ];
    var tierOpts = [
      { value: "ALL", label: "All" },
      { value: "TIER_1_HIGH", label: "T1: 70+" },
      { value: "TIER_2_MEDIUM", label: "T2: 40-69" },
      { value: "TIER_3_LOW", label: "T3: 20-39" },
      { value: "DISCARD", label: "Discard" },
    ];
    renderPills("pills-date", dateOpts, filters.date, "date");
    renderPills("pills-type", typeOpts, filters.type, "type");
    renderPills("pills-status", statOpts, filters.status, "status");
    renderPills("pills-tier", tierOpts, filters.tier, "tier");
    renderSourcePills();
  }

  document.addEventListener("click", function (e) {
    if (!e.target.classList.contains("pill")) return;
    var key = e.target.getAttribute("data-key");
    var val = e.target.getAttribute("data-val");

    if (key === "source") {
      // Multi-select: clicking a source toggles it on/off; clicking "All"
      // clears the list. filters.source is either "all" or "a,b,c".
      if (val === "all") {
        filters.source = "all";
      } else {
        var arr =
          !filters.source || filters.source === "all"
            ? []
            : filters.source.split(",");
        var idx = arr.indexOf(val);
        if (idx === -1) arr.push(val);
        else arr.splice(idx, 1);
        filters.source = arr.length === 0 ? "all" : arr.join(",");
      }
    } else {
      filters[key] = val;
    }

    saveFilters();
    currentPage = 1;
    sessionStorage.setItem("currentPage", 1);
    initPills();
    loadJobs();
  });

  function escapeHtml(str) {
    var d = document.createElement("div");
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  function escapeAttr(str) {
    var d = document.createElement("div");
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
  }

  function showToast() {
    var t = document.getElementById("toast");
    t.classList.add("show");
    setTimeout(function () {
      t.classList.remove("show");
    }, 2000);
  }

  function computeStats(jobs) {
    var s = {
      Pending: 0,
      Applied: 0,
      Interviewing: 0,
      Offered: 0,
      Rejected: 0,
      Archived: 0,
      Duplicate: 0,
      total: jobs.length,
    };
    for (var i = 0; i < jobs.length; i++) {
      var st = jobs[i].status;
      if (Object.prototype.hasOwnProperty.call(s, st)) s[st]++;
    }
    return s;
  }

  function renderStats(jobs) {
    var s = computeStats(jobs);
    var ids = [
      "stat-pending",
      "stat-applied",
      "stat-interviewing",
      "stat-offered",
      "stat-rejected",
      "stat-archived",
      "stat-duplicate",
      "stat-total",
    ];
    var keys = [
      "Pending",
      "Applied",
      "Interviewing",
      "Offered",
      "Rejected",
      "Archived",
      "Duplicate",
      "total",
    ];
    for (var i = 0; i < ids.length; i++) {
      document.getElementById(ids[i]).textContent = s[keys[i]];
    }
  }

  function updateSelectStyle(el) {
    el.className = "status-select";
    if (el.value) el.classList.add("status-" + el.value);
  }

  function renderTable(jobs, opts) {
    opts = opts || {};
    currentJobs = jobs;
    var tbody = document.getElementById("jobs-tbody");
    if (opts.silent) {
      tbody.classList.add("pulse-fade");
      setTimeout(function () { tbody.classList.remove("pulse-fade"); }, 20);
    }
    var table = document.getElementById("jobs-table");
    var empty = document.getElementById("empty-state");
    document.getElementById("loading").style.display = "none";

    if (!jobs || jobs.length === 0) {
      table.style.display = "none";
      empty.style.display = "block";
      document.getElementById("pagination-info").textContent = "";
      document.getElementById("btn-prev-page").disabled = true;
      document.getElementById("btn-next-page").disabled = true;
      return;
    }

    var isWorker = window.workerViewMode === true;
    var PAGE_SIZE = currentLimit || 100;
    var totalPages, pageJobs;

    if (isWorker) {
      totalPages = Math.max(1, Math.ceil(jobs.length / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = 1;
      pageJobs = jobs.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE,
      );
    } else {
      pageJobs = jobs;
      totalPages = Math.max(1, Math.ceil(currentTotal / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages || 1;
    }

    empty.style.display = "none";
    table.style.display = "";
    var now = Date.now(),
      html = "";
    for (var i = 0; i < pageJobs.length; i++) {
      var job = pageJobs[i];
      var vc = job.isClicked ? " row-visited" : "";
      var st =
        job.title.length > 60 ? job.title.substring(0, 57) + "..." : job.title;
      var sc =
        job.company.length > 30
          ? job.company.substring(0, 27) + "..."
          : job.company;
      var age = "";
      if (job.postedAt) {
        var dm = now - new Date(job.postedAt).getTime(),
          dh = Math.floor(dm / 3600000);
        age =
          dh < 1 ? "< 1hr" : dh < 24 ? dh + "hrs" : Math.floor(dh / 24) + "d";
      } else {
        var sm = now - new Date(job.scrapedAt).getTime(),
          sh = Math.floor(sm / 3600000);
        age = sh < 1 ? "new" : sh < 24 ? sh + "hrs" : Math.floor(sh / 24) + "d";
      }
      var ts =
        (job.region || "").toLowerCase().indexOf("remote") !== -1
          ? "Remote"
          : (job.region || "").toLowerCase().indexOf("hybrid") !== -1
            ? "Hybrid"
            : "On-site";
      var ad = age + " - " + ts;
      var link = job.applyUrl || job.url,
        label = job.applyUrl ? "Apply" : "Open";
      html += '<tr id="row-' + job._id + '" class="job-row' + vc + '">';
      html +=
        '<td class="cell-no">' +
        ((currentPage - 1) * PAGE_SIZE + i + 1) +
        "</td>";
      html +=
        '<td class="cell-company" title="' +
        escapeAttr(job.company) +
        '">' +
        escapeHtml(sc) +
        "</td>";
      html +=
        '<td class="cell-title" title="' +
        escapeAttr(job.title) +
        '">' +
        escapeHtml(st) +
        "</td>";
      html +=
        '<td class="cell-region">' +
        escapeHtml(job.region || "Remote") +
        "</td>";
      html +=
        '<td><span class="cell-source">' +
        escapeHtml(job.platformSource) +
        "</span></td>";
      html +=
        '<td style="font-size:11px;color:var(--text-secondary);white-space:nowrap">' +
        ad +
        "</td>";
      html +=
        '<td class="cell-link"><a class="apply-btn" href="' +
        escapeAttr(link) +
        '" target="_blank" rel="noopener" data-id="' +
        job._id +
        '">' +
        (job.applyUrl ? "⚡ Apply" : "↗ Open") +
        "</a></td>";
      var score = job.score != null ? job.score : null;
      var scCol =
        score !== null
          ? score >= 70
            ? "#00b894"
            : score >= 35
              ? "#fdcb6e"
              : score >= 25
                ? "#ff8686"
                : "#b2bec3"
          : "#dfe6e9";
      var mr =
        job.matchedRules && job.matchedRules.length
          ? job.matchedRules.join(", ")
          : "";
      html +=
        '<td style="text-align:center"><span title="' +
        escapeAttr(mr) +
        '" style="display:inline-block;background:' +
        scCol +
        ';color:#fff;border-radius:4px;padding:2px 8px;font-weight:600;font-size:12px">' +
        (score !== null ? score : "-") +
        "</span></td>";
      html +=
        '<td><select class="status-select status-' +
        job.status +
        '" data-id="' +
        job._id +
        '">';
      for (var s = 0; s < VALID_STATUSES.length; s++) {
        html +=
          '<option value="' +
          VALID_STATUSES[s] +
          '"' +
          (job.status === VALID_STATUSES[s] ? " selected" : "") +
          ">" +
          VALID_STATUSES[s] +
          "</option>";
      }
      html += "</select></td>";
      html +=
        '<td><button class="btn-quick-skip" data-id="' +
        job._id +
        '" style="background:#d63031;color:#fff;border:none;padding:3px 10px;border-radius:4px;font-size:11px;cursor:pointer">Skip</button></td></tr>';
    }
    tbody.innerHTML = html;
    var displayTotal = isWorker ? jobs.length : currentTotal;
    document.getElementById("pagination-info").textContent =
      "Page " +
      currentPage +
      " of " +
      totalPages +
      " (" +
      displayTotal +
      " total)";
    document.getElementById("btn-prev-page").disabled = currentPage <= 1;
    document.getElementById("btn-next-page").disabled =
      currentPage >= totalPages;
  }

  function buildQuery() {
    var q = "?page=" + currentPage + "&limit=" + currentLimit;
    if (filters.status !== "all")
      q += "&status=" + encodeURIComponent(filters.status);
    if (filters.date !== "all")
      q += "&date=" + encodeURIComponent(filters.date);
    if (filters.type !== "all")
      q += "&type=" + encodeURIComponent(filters.type);
    if (filters.tier !== "ALL")
      q += "&tier=" + encodeURIComponent(filters.tier);
    if (filters.source && filters.source !== "all")
      q += "&source=" + encodeURIComponent(filters.source);
    // workerId intentionally not sent — every worker sees all jobs
    return q;
  }

  function loadJobs(opts) {
    opts = opts || {};
    var silent = !!opts.silent;
    var ld = document.getElementById("loading");

    if (!silent) {
      ld.style.display = "block";
      document.getElementById("jobs-table").style.display = "none";
      document.getElementById("empty-state").style.display = "none";
    }

    fetch("/api/jobs" + buildQuery())
      .then(function (r) {
        if (!r.ok) throw Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (d) {
        currentTotal = d.total || 0;
        renderTable(d.jobs || [], { silent: silent });
        if (d.jobs && d.jobs.length) renderStats(d.jobs);
        else {
          var zeroes = {
            Pending: 0,
            Applied: 0,
            Interviewing: 0,
            Offered: 0,
            Rejected: 0,
            Archived: 0,
            Duplicate: 0,
            total: 0,
          };
          for (var k in zeroes)
            document.getElementById(
              "stat-" + (k === "total" ? k : k.toLowerCase()),
            ).textContent = "0";
        }
      })
      .catch(function (err) {
        console.error("Failed to load jobs:", err);
        ld.innerHTML =
          '<span style="color:#d63031">Error loading jobs. Is the server running?</span>';
      });
  }

  function handleLinkClick(e) {
    var t = e.target;
    if (!t.matches(".cell-link a")) return;
    e.preventDefault();
    var id = t.getAttribute("data-id"),
      url = t.getAttribute("href");
    window.open(url, "_blank", "noopener");
    var row = document.getElementById("row-" + id);
    if (row) row.classList.add("row-visited");
    fetch("/api/jobs/" + id + "/click", { method: "PATCH" }).catch(
      function (err) {
        console.error("Click tracking failed:", err);
      },
    );
  }

  function handleStatusChange(e) {
    if (!e.target.matches(".status-select")) return;
    var sel = e.target,
      id = sel.getAttribute("data-id"),
      ns = sel.value;
    updateSelectStyle(sel);
    fetch("/api/jobs/" + id + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: ns }),
    })
      .then(function (r) {
        if (!r.ok) throw Error("HTTP " + r.status);
      })
      .then(function () {
        for (var i = 0; i < currentJobs.length; i++) {
          if (currentJobs[i]._id === id) {
            currentJobs[i].status = ns;
            break;
          }
        }
        renderStats(currentJobs);
      })
      .catch(function (err) {
        console.error("Status update failed:", err);
      });
  }

  document.addEventListener("click", handleLinkClick);
  document.addEventListener("change", handleStatusChange);

  document.addEventListener("click", function (e) {
    if (!e.target.matches(".btn-quick-skip")) return;
    var id = e.target.getAttribute("data-id");
    fetch("/api/jobs/" + id + "/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Skipped" }),
    })
      .then(function (r) {
        if (!r.ok) throw Error("HTTP " + r.status);
      })
      .then(function () {
        for (var i = 0; i < currentJobs.length; i++) {
          if (currentJobs[i]._id === id) {
            currentJobs[i].status = "Skipped";
            break;
          }
        }
        renderStats(currentJobs);
        var sel = document.querySelector('select[data-id="' + id + '"]');
        if (sel) {
          sel.value = "Skipped";
          updateSelectStyle(sel);
        }
        if (window.updateWorkerProgress) window.updateWorkerProgress();
      })
      .catch(function (err) {
        console.error("Skip failed:", err);
      });
  });

  document
    .getElementById("btn-prev-page")
    .addEventListener("click", function () {
      if (currentPage > 1) {
        currentPage--;
        sessionStorage.setItem("currentPage", currentPage);
        window.workerViewMode ? renderTable(currentJobs) : loadJobs();
      }
    });
  document
    .getElementById("btn-next-page")
    .addEventListener("click", function () {
      if (window.workerViewMode) {
        var totalPages = Math.max(
          1,
          Math.ceil(currentJobs.length / (currentLimit || 100)),
        );
        if (currentPage < totalPages) {
          currentPage++;
          sessionStorage.setItem("currentPage", currentPage);
          renderTable(currentJobs);
        }
      } else {
        if (currentPage * currentLimit < currentTotal) {
          currentPage++;
          sessionStorage.setItem("currentPage", currentPage);
          loadJobs();
        }
      }
    });
  document.getElementById("btn-refresh").addEventListener("click", function () {
    currentPage = 1;
    sessionStorage.setItem("currentPage", 1);
    loadJobs();
  });

  window.VALID_STATUSES = VALID_STATUSES;
  window.currentJobs = currentJobs;
  window.currentTotal = currentTotal;
  window.filters = filters;
  window.currentPage = currentPage;
  window.currentLimit = currentLimit;
  window.renderTable = renderTable;
  window.renderStats = renderStats;
  window.computeStats = computeStats;
  window.loadJobs = loadJobs;
  window.escapeHtml = escapeHtml;
  window.escapeAttr = escapeAttr;
  window.showToast = showToast;
  window.initPills = initPills;
  window.saveFilters = saveFilters;
  window.updateSelectStyle = updateSelectStyle;
  window.__adminWorkerFilter = "";

  function updateUnassignedCount() {
    fetch("/api/jobs/unassigned-count")
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        var el = document.getElementById("unassigned-pool-count");
        if (el) el.textContent = "Unassigned: " + (d.count || 0);
      })
      .catch(function () {});
  }

  window.updateUnassignedCount = updateUnassignedCount;

  initPills();
  var isAdminCheck =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    new URLSearchParams(window.location.search).get("admin") === "true";
  if (isAdminCheck) {
    loadJobs();
  }
  updateUnassignedCount();

  // ── LIVE UPDATES ──
  // Poll /api/jobs/pulse every 10s. Only re-fetch the full jobs list
  // when something actually changed (count, latest updatedAt, or hash of
  // the 100 most recent rows). Skips when the tab is hidden, when a
  // previous poll is still in flight, or when the user is focused on a
  // form control inside the table so we never clobber their typing.
  var _pulseLast = { count: -1, latestUpdatedAt: 0, hash: "" };
  var _pulseBusy = false;
  var _pulseTimerId = null;

  var _lastScrollAt = 0;
  window.addEventListener(
    "scroll",
    function () {
      _lastScrollAt = Date.now();
    },
    { passive: true },
  );

  function _pulseTick() {
    if (document.hidden) return;
    if (_pulseBusy) return;

    // Don't interrupt form interactions
    var focused = document.activeElement;
    if (
      focused &&
      (focused.tagName === "SELECT" ||
        focused.tagName === "INPUT" ||
        focused.tagName === "TEXTAREA")
    )
      return;

    // Don't yank content while the user is reading / scrolling
    if (Date.now() - _lastScrollAt < 15000) return;

    _pulseBusy = true;
    fetch("/api/jobs/pulse")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (p) {
        if (!p) return;
        var changed =
          p.count !== _pulseLast.count ||
          p.latestUpdatedAt !== _pulseLast.latestUpdatedAt ||
          p.hash !== _pulseLast.hash;
        if (changed) {
          _pulseLast = {
            count: p.count,
            latestUpdatedAt: p.latestUpdatedAt,
            hash: p.hash,
          };
          // Silent: no spinner, table stays visible, rows swap in place
          loadJobs({ silent: true });
        }
      })
      .catch(function () {})
      .finally(function () {
        _pulseBusy = false;
      });
  }
  function _startPulse() {
    if (_pulseTimerId !== null) return;
    _pulseTimerId = setInterval(_pulseTick, 20000);
  }
  function _stopPulse() {
    if (_pulseTimerId === null) return;
    clearInterval(_pulseTimerId);
    _pulseTimerId = null;
  }

  // Pause polling when the tab is hidden, resume when it comes back
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      _stopPulse();
    } else {
      _startPulse();
      _pulseTick(); // fire one immediately after the tab wakes up
    }
  });

  // Kick it off
  _startPulse();
})();
