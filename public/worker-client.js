(function () {
  "use strict";

  var activeWorker = null;

  var isAdmin = window.location.hostname === "localhost" ||
                window.location.hostname === "127.0.0.1" ||
                new URLSearchParams(window.location.search).get("admin") === "true";

  function initWorker() {
    if (isAdmin) return;

    // Legacy "Return Jobs" button kept visible — every worker now sees all
    // jobs so returning an assignment is a no-op, but the button remains
    // for anyone who wants to see the original distribution UI in the future.
    var btnReturn = document.getElementById("btn-return-jobs");
    if (btnReturn) btnReturn.style.display = "";

    var storedId = localStorage.getItem("workerId");
    fetch("/api/workers/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: storedId || null }),
    })
      .then(function (r) { return r.json(); })
      .then(function (w) {
        if (w.mode === "admin") return;
        activeWorker = w;
        localStorage.setItem("workerId", w.workerId);

        // Show the worker badge (identity + color) — purely cosmetic now
        var badge = document.getElementById("worker-badge");
        if (badge) {
          badge.style.display = "inline-block";
          badge.style.background = w.color;
          badge.textContent = w.workerId + " (" + w.name + ")";
        }

        // Every worker sees the full job pool — use the standard load path.
        // workerViewMode is intentionally NOT set, so dashboard.js uses
        // server-side pagination (same as admin).
        if (window.loadJobs) window.loadJobs();
      })
      .catch(function (err) {
        console.error("[Worker] Init failed:", err);
        // Even if registration fails, still load jobs so the laptop isn't stuck
        if (window.loadJobs) window.loadJobs();
      });
  }

  // ── Legacy Return Jobs modal ──
  // Kept wired so the button doesn't error, but the POST is a no-op on the
  // backend now (nothing is assigned).
  var btnReturn = document.getElementById("btn-return-jobs");
  var modal = document.getElementById("return-jobs-modal");
  var btnConfirm = document.getElementById("btn-return-confirm");
  var btnCancel = document.getElementById("btn-return-cancel");

  if (btnReturn && modal) {
    btnReturn.addEventListener("click", function () {
      modal.classList.remove("hidden");
    });
  }
  if (btnCancel && modal) {
    btnCancel.addEventListener("click", function () {
      modal.classList.add("hidden");
    });
  }
  if (modal) {
    modal.addEventListener("click", function (e) {
      if (e.target === modal) modal.classList.add("hidden");
    });
  }
  if (btnConfirm) {
    btnConfirm.addEventListener("click", function () {
      if (modal) modal.classList.add("hidden");
      // Backend no longer tracks assignments per worker, so this is a
      // purely cosmetic close. If we ever re-enable the assignment model,
      // wire this back to /api/workers/return-jobs.
    });
  }

  initWorker();

  // Legacy globals kept so existing references don't break
  window.workerViewMode = false;
  window.updateWorkerProgress = function () {};
})();