(function () {
  "use strict";

  var isAdmin = window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1' ||
                new URLSearchParams(window.location.search).get('admin') === 'true';

  var adminPollInterval = null;
  var adminVisible = false;
  var scrapePollInterval = null;
  var jobRefreshInterval = null;

  function applyAdminWorkerMode() {
    var aa = document.getElementById('admin-actions');
    var ap = document.getElementById('admin-panel');
    if (isAdmin) {
      if (aa) aa.style.display = '';
      if (ap) ap.style.display = 'block';
      startAdminPolling();
    } else {
      if (aa) aa.style.display = 'none';
      if (ap) ap.style.display = 'none';
    }
  }

  function startAdminPolling() {
    if (adminPollInterval) return;
    loadAdminStats();
    adminPollInterval = setInterval(loadAdminStats, 10000);
  }

  function toggleAdminPanel() {
    adminVisible = !adminVisible;
    var p = document.getElementById('admin-panel');
    p.style.display = adminVisible ? 'block' : 'none';
    if (adminVisible) loadAdminStats();
  }

  function loadAdminStats() {
    fetch('/api/workers/stats')
      .then(function (r) { return r.json(); })
      .then(function (workers) {
        var h = '';
        for (var i = 0; i < workers.length; i++) {
          var w = workers[i];
          var pending = (w.todayCounts && w.todayCounts.Pending) || 0;
          var applied = (w.todayCounts && w.todayCounts.Applied) || 0;
          var interviewing = (w.todayCounts && w.todayCounts.Interviewing) || 0;
          var offered = (w.todayCounts && w.todayCounts.Offered) || 0;
          var rejected = (w.todayCounts && w.todayCounts.Rejected) || 0;
          var archived = (w.todayCounts && w.todayCounts.Archived) || 0;
          var duplicate = (w.todayCounts && w.todayCounts.Duplicate) || 0;
          var manualReview = (w.todayCounts && w.todayCounts["Manual Review"]) || 0;
          var skipped = (w.todayCounts && w.todayCounts.Skipped) || 0;
          var selectStatus = (w.todayCounts && w.todayCounts["Select Status"]) || 0;
          var total = pending + applied + interviewing + offered + rejected + archived + duplicate + manualReview + skipped + selectStatus;
          var assignedCount = w.assignedCount || w.assignedJobCount || total;
          var completedCount = w.completedCount || (total - pending - selectStatus);
          var progressPercent = assignedCount > 0 ? Math.min(100, Math.max(0, Math.round((completedCount / assignedCount) * 100))) : 0;
          h += '<tr>' +
            '<td>' + w.name + ' <small>(' + w.workerId + ')</small></td>' +
            '<td><span style="display:inline-block;width:16px;height:16px;background:' + w.color + ';border-radius:50%"></span></td>' +
            '<td><code style="font-size:11px;background:#f0f0f5;padding:2px 6px;border-radius:4px">' + (w.assignedRange || '-') + '</code></td>' +
            '<td>' + (w.assignedCount || w.assignedJobCount || total) + '</td>' +
            '<td>' + pending + '</td>' +
            '<td>' + applied + '</td>' +
            '<td>' + interviewing + '</td>' +
            '<td>' + offered + '</td>' +
            '<td>' + rejected + '</td>' +
            '<td>' + archived + '</td>' +
            '<td>' + duplicate + '</td>' +
            '<td>' + manualReview + '</td>' +
            '<td>' + skipped + '</td>' +
            '<td>' + new Date(w.lastActive).toLocaleString() + '</td>' +
            '<td><div style="background:#dfe6e9;border-radius:4px;height:8px;width:100%"><div style="background:' + w.color + ';height:8px;width:' + progressPercent + '%;border-radius:4px"></div></div><span style="font-size:10px;color:var(--text-secondary)">' + completedCount + '/' + assignedCount + ' (' + progressPercent + '%)</span></td>' +
            '<td>' +
              '<select class="manual-assign-count" data-worker="' + w.workerId + '" style="padding:2px 4px;border:1px solid var(--border);border-radius:3px;font-size:11px">' +
                '<option value="50">50</option>' +
                '<option value="100" selected>100</option>' +
                '<option value="150">150</option>' +
              '</select> ' +
              '<button class="btn-manual-assign" data-worker="' + w.workerId + '" style="background:var(--primary);color:#fff;border:none;padding:2px 8px;border-radius:3px;font-size:11px;cursor:pointer">Assign</button> ' +
              '<button class="btn-delete-worker" data-worker="' + w.workerId + '" style="background:#d63031;color:#fff;border:none;padding:2px 8px;border-radius:3px;font-size:11px;cursor:pointer" title="Delete worker + return their jobs">Del</button>' +
            '</td></tr>';
        }
        document.getElementById('worker-monitor-tbody').innerHTML = h;

        var sel = document.getElementById('worker-filter-selector');
        if (sel) {
          var cv = sel.value;
          var opts = '<option value="">All Workers</option>';
          for (var j = 0; j < workers.length; j++) {
            var w2 = workers[j];
            opts += '<option value="' + w2.workerId + '"' + (w2.workerId === cv ? ' selected' : '') + '>' + w2.name + ' (' + w2.workerId + ') ' + (w2.assignedRange || '') + '</option>';
          }
          sel.innerHTML = opts;
          if (cv) {
            var rb = document.getElementById('worker-range-badge');
            for (var k = 0; k < workers.length; k++) {
              if (workers[k].workerId === cv) {
                if (workers[k].assignedRange) { rb.style.display = 'inline-block'; rb.textContent = workers[k].assignedRange; }
                else rb.style.display = 'none';
                break;
              }
            }
          }
        }
      });
    if (window.updateUnassignedCount) window.updateUnassignedCount();
  }

  applyAdminWorkerMode();

  if (isAdmin) {
    var wf = document.getElementById('worker-filter-container');
    if (wf) wf.style.display = 'flex';
  }

  document.getElementById('btn-admin').addEventListener('click', toggleAdminPanel);

  var wfs = document.getElementById('worker-filter-selector');
  if (wfs) {
    wfs.addEventListener('change', function () {
      window.__adminWorkerFilter = this.value;
      var rb = document.getElementById('worker-range-badge');
      if (window.__adminWorkerFilter) {
        fetch('/api/workers/stats')
          .then(function (r) { return r.json(); })
          .then(function (workers) {
            for (var i = 0; i < workers.length; i++) {
              if (workers[i].workerId === window.__adminWorkerFilter && workers[i].assignedRange) {
                rb.style.display = 'inline-block'; rb.textContent = workers[i].assignedRange; return;
              }
            }
            rb.style.display = 'none';
          });
      } else { rb.style.display = 'none'; }
      window.currentPage = 1;
      sessionStorage.setItem("currentPage", 1);
      window.loadJobs();
    });
  }

  function showProgressBar(data) {
    var d = document.getElementById('scrape-progress');
    d.style.display = 'block';
    if (data) updateProgress(data);
  }

  function updateProgress(data) {
    var pct = data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0;
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-text').textContent = pct + '% (' + data.inserted + ' inserted, ' + data.duplicates + ' dupes)';
  }

  function hideProgressBar() {
    document.getElementById('scrape-progress').style.display = 'none';
    if (scrapePollInterval) { clearInterval(scrapePollInterval); scrapePollInterval = null; }
    if (jobRefreshInterval) { clearInterval(jobRefreshInterval); jobRefreshInterval = null; }
  }

  function startScrapePolling() {
    if (scrapePollInterval) return;
    scrapePollInterval = setInterval(function () {
      fetch("/api/scrape/status")
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.status === "running" || data.status === "idle") {
            if (data.status === "running") {
              showProgressBar(data);
              if (!jobRefreshInterval) { jobRefreshInterval = setInterval(function () { window.loadJobs(); }, 300000); }
            } else {
              clearInterval(scrapePollInterval); scrapePollInterval = null;
              if (jobRefreshInterval) { clearInterval(jobRefreshInterval); jobRefreshInterval = null; }
              hideProgressBar(); window.loadJobs();
            }
          } else {
            clearInterval(scrapePollInterval); scrapePollInterval = null;
            if (jobRefreshInterval) { clearInterval(jobRefreshInterval); jobRefreshInterval = null; }
            hideProgressBar(); window.loadJobs();
          }
        }).catch(function () {});
    }, 2000);
  }

  function resumeScrapePollingIfRunning() {
    fetch("/api/scrape/status")
      .then(function (r) { return r.json(); })
      .then(function (data) { if (data.status === "running") { showProgressBar(data); startScrapePolling(); } })
      .catch(function () {});
  }

  document.getElementById("btn-scrape").addEventListener("click", function () {
    var btn = this, orig = btn.textContent;
    btn.textContent = "Scraping..."; btn.disabled = true;
    showProgressBar({ total: 0, processed: 0, inserted: 0, duplicates: 0 });
    startScrapePolling();
    fetch("/api/scrape", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function () { window.loadJobs(); })
      .catch(function (err) { console.error("Scrape failed:", err); })
      .finally(function () { btn.textContent = orig; btn.disabled = false; });
  });

  document.getElementById("btn-full-scrape").addEventListener("click", function () {
    var btn = this, orig = btn.textContent;
    btn.textContent = "Scraping..."; btn.disabled = true;
    showProgressBar({ total: 0, processed: 0, inserted: 0, duplicates: 0 });
    startScrapePolling();
    fetch("/api/scrape", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function () {
        setTimeout(function () { btn.textContent = orig; btn.disabled = false; }, 2500);
      })
      .catch(function (err) { console.error("[FULL] Failed:", err); btn.textContent = orig; btn.disabled = false; hideProgressBar(); });
  });

  document.getElementById("btn-purge").addEventListener("click", function () {
    if (!confirm("Purge all pending jobs older than 7 days?")) return;
    var btn = this, orig = btn.textContent;
    btn.textContent = "Purging..."; btn.disabled = true;
    fetch("/api/jobs/purge", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (result) { console.log("Purge result:", result); window.showToast(); window.loadJobs(); })
      .catch(function (err) { console.error("Purge failed:", err); })
      .finally(function () { btn.textContent = orig; btn.disabled = false; });
  });

  document.getElementById("btn-distribute-all").addEventListener("click", function () {
    var btn = this, orig = btn.textContent;
    btn.textContent = "Distributing..."; btn.disabled = true;
    fetch("/api/workers/distribute-all", { method: "POST" })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        console.log("Distribute result:", data);
        alert("Distributed " + data.assignedTotal + " jobs to " + data.workerCount + " workers.");
        loadAdminStats();
        if (window.updateUnassignedCount) window.updateUnassignedCount();
      })
      .catch(function (err) { console.error("Distribute failed:", err); })
      .finally(function () { btn.textContent = orig; btn.disabled = false; });
  });

  document.addEventListener("click", function (e) {
    if (!e.target.matches(".btn-manual-assign")) return;
    var workerId = e.target.getAttribute("data-worker");
    var row = e.target.closest("tr");
    var sel = row ? row.querySelector(".manual-assign-count") : null;
    var count = sel ? parseInt(sel.value, 10) : 100;
    var btn = e.target, orig = btn.textContent;
    btn.textContent = "..."; btn.disabled = true;
    fetch("/api/workers/assign-manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: workerId, count: count }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        console.log("Manual assign result:", data);
        loadAdminStats();
        if (window.updateUnassignedCount) window.updateUnassignedCount();
      })
      .catch(function (err) { console.error("Manual assign failed:", err); })
      .finally(function () { btn.textContent = orig; btn.disabled = false; });
  });

  document.addEventListener("click", function (e) {
    if (!e.target.matches(".btn-delete-worker")) return;
    var workerId = e.target.getAttribute("data-worker");
    if (!confirm("Delete worker " + workerId + " and return all their jobs to the pool?")) return;
    var btn = e.target, orig = btn.textContent;
    btn.textContent = "..."; btn.disabled = true;
    fetch("/api/workers/" + workerId, { method: "DELETE" })
      .then(function (r) { return r.json(); })
      .then(function () {
        loadAdminStats();
        if (window.updateUnassignedCount) window.updateUnassignedCount();
        window.loadJobs();
      })
      .catch(function (err) { console.error("Delete worker failed:", err); })
      .finally(function () { btn.textContent = orig; btn.disabled = false; });
  });

  document.getElementById("btn-dedup").addEventListener("click", function () {
    if (!confirm("This will scan all Pending jobs across all runs and flag duplicates. Continue?")) return;
    var btn = this, orig = btn.textContent;
    btn.textContent = "Processing Duplicates..."; btn.disabled = true;
    fetch("/api/jobs/dedup-cross-run", { method: "POST" })
      .then(function (r) { if (!r.ok) throw Error("HTTP " + r.status); return r.json(); })
      .then(function (result) {
        console.log("Dedup result:", result);
        alert("Cross-run dedup complete!\nEvaluated: " + result.evaluated + " jobs\nFlagged as duplicates: " + result.flagged);
        window.showToast(); window.loadJobs();
      })
      .catch(function (err) { console.error("Dedup failed:", err); alert("Dedup failed: " + err.message); })
      .finally(function () { btn.textContent = orig; btn.disabled = false; });
  });

  // ── Log / Metrics Overlays ──
  var logBtn = document.getElementById("btn-logs");
  var logOverlay = document.getElementById("log-overlay");
  var logTimestamp = document.getElementById("log-timestamp");
  var logAggregate = document.getElementById("log-aggregate");
  var logEntries = document.getElementById("log-entries");
  var logCloseBtn = document.getElementById("log-close-btn");
  var logRunSelector = document.getElementById("log-run-selector");

  var mainRunSelector = document.getElementById("main-run-selector");
  var btnMetrics = document.getElementById("btn-metrics");
  var metricsOverlay = document.getElementById("metrics-overlay");
  var metricsRunSelector = document.getElementById("metrics-run-selector");
  var metricsCloseBtn = document.getElementById("metrics-close-btn");

  var allRuns = [], allLogRuns = [];

  function fetchAndPopulateRunSelectors() {
    fetch("/api/scrape/logs")
      .then(function (r) { return r.json(); })
      .then(function (runs) { populateMainRunSelector(runs); populateMetricsRunSelector(runs); })
      .catch(function () {});
  }

  function populateMainRunSelector(runs) {
    allLogRuns = runs || [];
    var opts = '<option value="">All Runs</option>';
    var srt = allLogRuns.slice().sort(function (a, b) { return new Date(b.startedAt||0) - new Date(a.startedAt||0); });
    for (var i = 0; i < srt.length; i++) {
      var r = srt[i];
      opts += '<option value="' + r.startedAt + '|' + r.finishedAt + '">Run #' + r.runId + ' \u2014 ' + (r.shortTimestamp || r.timestamp || '') + '</option>';
    }
    mainRunSelector.innerHTML = opts;
  }

  mainRunSelector.addEventListener("change", function () {
    var v = this.value;
    if (!v) { window.loadJobs(); return; }
    var p = v.split("|");
    loadJobsFiltered("?startedAt=" + encodeURIComponent(p[0]) + "&finishedAt=" + encodeURIComponent(p[1]));
  });

  function loadJobsFiltered(qs) {
    var ld = document.getElementById("loading");
    ld.style.display = "block";
    document.getElementById("jobs-table").style.display = "none";
    document.getElementById("empty-state").style.display = "none";
    qs = qs || "";
    if (window.__adminWorkerFilter) qs += (qs.indexOf("?") !== -1 ? "&" : "?") + "workerId=" + encodeURIComponent(window.__adminWorkerFilter);
       if (window.filters.status !== "all") qs += (qs.indexOf("?") !== -1 ? "&" : "?") + "status=" + encodeURIComponent(window.filters.status);
    if (window.filters.date !== "all") qs += (qs.indexOf("?") !== -1 ? "&" : "?") + "date=" + encodeURIComponent(window.filters.date);
    if (window.filters.type !== "all") qs += (qs.indexOf("?") !== -1 ? "&" : "?") + "type=" + encodeURIComponent(window.filters.type);
    if (window.filters.tier !== "ALL") qs += (qs.indexOf("?") !== -1 ? "&" : "?") + "tier=" + encodeURIComponent(window.filters.tier);
    if (window.filters.source && window.filters.source !== "all") qs += (qs.indexOf("?") !== -1 ? "&" : "?") + "source=" + encodeURIComponent(window.filters.source);
    fetch("/api/jobs" + qs)
      .then(function (r) { if (!r.ok) throw Error("HTTP " + r.status); return r.json(); })
      .then(function (jobs) { window.renderTable(jobs); })
      .catch(function (err) { console.error("Failed to load jobs:", err); ld.innerHTML = '<span style="color:#d63031">Error loading jobs. Is the server running?</span>'; });
  }

  var _origLoadJobs = window.loadJobs;
  window.loadJobs = function () { _origLoadJobs(); fetchAndPopulateRunSelectors(); };

  function openLogPane() { logOverlay.classList.remove("hidden"); fetchLogs(); }
  function closeLogPane() { logOverlay.classList.add("hidden"); }

  function formatEntry(entry) {
    return '<span class="p">' + window.escapeHtml(entry.platform||"Unknown") + '</span> (<span class="r">' +
      window.escapeHtml((entry.region && entry.region !== "all") ? entry.region : "global") + '</span>) = <span class="c">' +
      (typeof entry.count === "number" ? entry.count : 0) + '</span> jobs <span class="k">' + window.escapeHtml(entry.keyword||"unknown") + '</span>';
  }

  function renderRun(run) {
    if (!run) { logTimestamp.textContent = "No data"; logAggregate.style.display = "none"; logEntries.innerHTML = '<div class="log-empty">No run data available.</div>'; return; }
    logTimestamp.textContent = "Run #" + run.runId + " \u2014 " + (run.timestamp || run.shortTimestamp || "");
    var po = run.platforms || {}, pk = Object.keys(po);
    logAggregate.style.display = "flex";
    logAggregate.innerHTML = "<span>Total Jobs: <strong>" + (run.totalJobs||0) + "</strong></span><span>Platforms: <strong>" + pk.length + "</strong></span>" +
      (pk.length ? "<span>Top: <strong>" + pk.sort(function (a, b) { return (po[b]||0) - (po[a]||0); }).slice(0, 5).join(", ") + "</strong></span>" : "");
    var entries = run.entries || [];
    if (!entries.length) { logEntries.innerHTML = '<div class="log-empty">No entry data in this run.</div>'; return; }
    var h = '';
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      h += '<div class="log-entry' + (e.isMeta ? " meta" : "") + '">' + formatEntry(e) + '</div>';
    }
    logEntries.innerHTML = h;
  }

  function populateRunSelector(runs) {
    allRuns = runs || [];
    var srt = allRuns.slice().sort(function (a, b) { return new Date(b.startedAt||0) - new Date(a.startedAt||0); });
    var opts = srt.length ? '' : '<option value="">No runs available</option>';
    for (var i = 0; i < srt.length; i++) {
      opts += '<option value="' + i + '">Run #' + srt[i].runId + ' \u2014 ' + (srt[i].shortTimestamp || srt[i].timestamp || '') + '</option>';
    }
    logRunSelector.innerHTML = opts;
    if (srt.length) { logRunSelector.value = "0"; renderRun(srt[0]); } else renderRun(null);
  }

  logRunSelector.addEventListener("change", function () {
    var idx = parseInt(this.value, 10);
    var srt = allRuns.slice().sort(function (a, b) { return new Date(b.startedAt||0) - new Date(a.startedAt||0); });
    if (idx >= 0 && idx < srt.length) renderRun(srt[idx]);
  });

  function fetchLogs() {
    logTimestamp.textContent = "Loading..."; logAggregate.style.display = "none";
    logEntries.innerHTML = '<div class="log-loading-msg">Loading scrape logs...</div>';
    fetch("/api/scrape/logs")
      .then(function (r) { if (!r.ok) throw Error("HTTP " + r.status); return r.json(); })
      .then(function (runs) { populateRunSelector(runs); })
      .catch(function (err) { console.error("Failed to load logs:", err); logTimestamp.textContent = "Error"; logEntries.innerHTML = '<div class="log-error">Failed to load logs: ' + err.message + '</div>'; });
  }

  logBtn.addEventListener("click", function () { logOverlay.classList.contains("hidden") ? openLogPane() : closeLogPane(); });
  logCloseBtn.addEventListener("click", closeLogPane);
  logOverlay.addEventListener("click", function (e) { if (e.target === logOverlay) closeLogPane(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !logOverlay.classList.contains("hidden")) closeLogPane(); });

  function populateMetricsRunSelector(runs) {
    var srt = (runs||[]).slice().sort(function (a, b) { return new Date(b.startedAt||0) - new Date(a.startedAt||0); });
    var opts = '<option value="">All History</option>';
    for (var i = 0; i < srt.length; i++) {
      opts += '<option value="' + i + '">Run #' + srt[i].runId + ' \u2014 ' + (srt[i].shortTimestamp || srt[i].timestamp || '') + '</option>';
    }
    metricsRunSelector.innerHTML = opts;
  }

  function computeMetrics(entries) {
    var pt = {}, rt = {}, kt = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i]; if (e.isMeta) continue;
      pt[e.platform||"Unknown"] = (pt[e.platform||"Unknown"]||0) + e.count;
      rt[e.region&&e.region!=="all"?e.region:"global"] = (rt[e.region&&e.region!=="all"?e.region:"global"]||0) + e.count;
      kt[e.keyword||"unknown"] = (kt[e.keyword||"unknown"]||0) + e.count;
    }
    var tp = ["-",0], lp = ["-",Infinity];
    for (var k in pt) { if (pt[k] > tp[1]) tp = [k, pt[k]]; if (pt[k] < lp[1] && pt[k] > 0) lp = [k, pt[k]]; }
    if (lp[1]===Infinity) lp = ["-",0];
    var tr = ["-",0], lr = ["-",Infinity];
    for (var rk in rt) { if (rt[rk] > tr[1]) tr = [rk, rt[rk]]; if (rt[rk] < lr[1] && rt[rk] > 0) lr = [rk, rt[rk]]; }
    if (lr[1]===Infinity) lr = ["-",0];
    var tk = ["-",0];
    for (var kk in kt) { if (kt[kk] > tk[1]) tk = [kk, kt[kk]]; }
    return { topPlat: tp, lowPlat: lp, topReg: tr, lowReg: lr, topKw: tk };
  }

  function renderMetrics(entries) {
    var m = computeMetrics(entries);
    document.getElementById("m-top-platform").textContent = m.topPlat[0];
    document.getElementById("m-top-platform-jobs").textContent = m.topPlat[1] + " jobs";
    document.getElementById("m-low-platform").textContent = m.lowPlat[0];
    document.getElementById("m-low-platform-jobs").textContent = m.lowPlat[1] + " jobs";
    document.getElementById("m-top-region").textContent = m.topReg[0];
    document.getElementById("m-top-region-jobs").textContent = m.topReg[1] + " jobs";
    document.getElementById("m-low-region").textContent = m.lowReg[0];
    document.getElementById("m-low-region-jobs").textContent = m.lowReg[1] + " jobs";
    document.getElementById("m-top-keyword").textContent = m.topKw[0];
    document.getElementById("m-top-keyword-jobs").textContent = m.topKw[1] + " jobs";
  }

  metricsRunSelector.addEventListener("change", function () {
    var idx = parseInt(this.value, 10);
    if (isNaN(idx)) {
      var ae = [];
      for (var i = 0; i < allLogRuns.length; i++) ae = ae.concat(allLogRuns[i].entries || []);
      renderMetrics(ae); return;
    }
    var srt = allLogRuns.slice().sort(function (a, b) { return new Date(b.startedAt||0) - new Date(a.startedAt||0); });
    if (idx >= 0 && idx < srt.length) renderMetrics(srt[idx].entries || []);
  });

  btnMetrics.addEventListener("click", function () {
    metricsOverlay.classList.remove("hidden");
    fetch("/api/scrape/logs")
      .then(function (r) { return r.json(); })
      .then(function (runs) {
        populateMetricsRunSelector(runs);
        var ae = [];
        for (var i = 0; i < runs.length; i++) ae = ae.concat(runs[i].entries || []);
        renderMetrics(ae);
      });
  });

  metricsCloseBtn.addEventListener("click", function () { metricsOverlay.classList.add("hidden"); });
  metricsOverlay.addEventListener("click", function (e) { if (e.target === metricsOverlay) metricsOverlay.classList.add("hidden"); });

  resumeScrapePollingIfRunning();
})();
