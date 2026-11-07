require("dotenv").config();

const express = require("express");
const path = require("path");
const cron = require("node-cron");
const mongoose = require("mongoose");
const connectDB = require("./db");
const Job = require("./models/Job");
const Worker = require("./models/Worker");
const { runAllScrapers } = require("./services/scraperOrchestrator");
const { scoreJob } = require("./services/scorer");
const { getScrapeProgress } = require("./services/scrapeProgress");
const { initLogger, getAllSessions } = require("../scripts/lib/logger");
const { normalizeCompanyName } = require("../scripts/lib/company-filter");
const { getSourceRank } = require("./utils/sourceRank");
const {
  titleSimilarity,
  groupByCompany,
} = require("./services/scraperOrchestrator");
const indeedRouter = require("./routes/indeed").router;
const glassdoorRouter = require("./routes/glassdoor");
const careerbuilderRouter = require("./routes/careerbuilder");
const diceRouter = require("./routes/dice");
const simplyhiredRouter = require("./routes/simplyhired");
const linkedinRouter = require("./routes/linkedin");

const app = express();
const PORT = process.env.PORT || 3000;
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || "Asia/Karachi";
const VALID_STATUSES = [
  "Select Status",
  "Pending",
  "Applied",
  "Interviewing",
  "Offered",
  "Rejected",
  "Archived",
  "Duplicate",
  "Manual Review",
  "Skipped",
  "TIER_1_HIGH",
  "TIER_2_MEDIUM",
  "TIER_3_LOW",
  "DISCARD",
];

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PATCH, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use(
  express.static(path.join(__dirname, "..", "public"), {
    index: "dashboard.html",
  }),
);

app.get("/api/health", (_req, res) => {
  const state = mongoose.connection.readyState;
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };
  res.json({
    status: "ok",
    db: states[state] || "unknown",
    uptime: process.uptime(),
  });
});

app.get("/api/profile", (_req, res) => {
  try {
    const profile = require("../config/profile.json");
    res.json(profile);
  } catch {
    res.status(500).json({ error: "Profile config not found" });
  }
});

app.get("/resume.pdf", (_req, res) => {
  const resumePath = path.join(__dirname, "..", "data", "Resume.pdf");
  res.sendFile(resumePath, (err) => {
    if (err) {
      console.error("[ERROR] Failed to send Resume.pdf:", err.message);
      res.status(404).json({ error: "Resume file not found in /data" });
    }
  });
});

app.get("/api/jobs", async (req, res, next) => {
  try {
    const filter = {};
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const skip = (page - 1) * limit;

    if (req.query.status && req.query.status !== "all") {
      if (!VALID_STATUSES.includes(req.query.status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
        });
      }
      filter.status = req.query.status;
    }

    if (req.query.date && req.query.date !== "all") {
      const now = Date.now();
      const ranges = { today: 1, "1d": 1, "3d": 3, "1w": 7 };
      const days = ranges[req.query.date] || 0;
      if (days > 0) {
        filter.scrapedAt = { $gte: new Date(now - days * 24 * 60 * 60 * 1000) };
      }
    }

    if (req.query.type && req.query.type !== "all") {
      if (req.query.type === "Remote") filter.region = /remote/i;
      else if (req.query.type === "Hybrid")
        filter.region = { $regex: /hybrid/i, $ne: /remote/i };
      else if (req.query.type === "On-site")
        filter.region = { $not: /remote|hybrid/i };
    }

    if (req.query.search) {
      const s = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { title: { $regex: s, $options: "i" } },
        { company: { $regex: s, $options: "i" } },
      ];
    }

    if (req.query.source && req.query.source !== "all") {
      var rawSources = String(req.query.source)
        .split(",")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
      if (rawSources.length === 1) {
        filter.source = {
          $regex: new RegExp("^" + escapeRegex(rawSources[0]) + "$", "i"),
        };
      } else if (rawSources.length > 1) {
        filter.source = {
          $in: rawSources.map(function (s) {
            return new RegExp("^" + escapeRegex(s) + "$", "i");
          }),
        };
      }
    }

    if (req.query.tier && req.query.tier !== "ALL") {
      if (req.query.tier === "TIER_1_HIGH") filter.score = { $gte: 70 };
      else if (req.query.tier === "TIER_2_MEDIUM")
        filter.score = { $gte: 40, $lt: 70 };
      else if (req.query.tier === "TIER_3_LOW")
        filter.score = { $gte: 20, $lt: 40 };
      else if (req.query.tier === "DISCARD") filter.score = { $lt: 20 };
    }

    const [total, jobs] = await Promise.all([
      Job.countDocuments(filter),
      Job.find(filter).sort({ scrapedAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    console.log(
      `[API] GET /api/jobs → page=${page} limit=${limit} total=${total} returned=${jobs.length}`,
    );
    res.json({ total, page, limit, jobs });
  } catch (err) {
    next(err);
  }
});

app.get("/api/jobs/pulse", async (_req, res, next) => {
  try {
    const count = await Job.estimatedDocumentCount();

    let latestUpdatedAt = 0;
    try {
      const latest = await Job.findOne({})
        .sort({ updatedAt: -1 })
        .select("updatedAt")
        .lean();
      if (latest && latest.updatedAt)
        latestUpdatedAt = new Date(latest.updatedAt).getTime();
    } catch (e) {
      try {
        const latest2 = await Job.findOne({})
          .sort({ scrapedAt: -1 })
          .select("scrapedAt")
          .lean();
        if (latest2 && latest2.scrapedAt)
          latestUpdatedAt = new Date(latest2.scrapedAt).getTime();
      } catch (e2) {
        /* nothing we can do */
      }
    }

    const recent = await Job.find({})
      .sort({ _id: -1 })
      .limit(100)
      .select("_id status isClicked")
      .lean();
    const hash = recent
      .map(
        (j) =>
          String(j._id).slice(-6) +
          (j.status || "").charAt(0) +
          (j.isClicked ? "1" : "0"),
      )
      .join("");

    res.json({ count, latestUpdatedAt, hash });
  } catch (err) {
    next(err);
  }
});

app.get("/api/jobs/unassigned-count", async (_req, res, next) => {
  try {
    const count = await Job.countDocuments({
      assignedWorkerId: null,
      status: {
        $nin: ["DISCARD", "Duplicate", "Applied", "Rejected", "Archived"],
      },
    });
    res.json({ count });
  } catch (err) {
    next(err);
  }
});

app.post("/api/jobs/bulk", async (req, res, next) => {
  try {
    const { jobs } = req.body;
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return res
        .status(400)
        .json({ error: 'Body must contain a "jobs" array' });
    }

    const bulkOps = [];
    let scored = 0;

    for (const job of jobs) {
      if (!job.url || !job.title || !job.company) continue;
      const scoring = scoreJob(job);
      job.score = scoring.score;
      job.matchedRules = scoring.matchedRules;
      if (!job.status) job.status = "Pending";
      scored++;
      bulkOps.push({
        updateOne: {
          filter: { url: job.url },
          update: { $setOnInsert: job },
          upsert: true,
        },
      });
    }

    if (bulkOps.length === 0) {
      return res.json({ inserted: 0, scored: 0 });
    }

    let inserted = 0;
    try {
      const result = await Job.bulkWrite(bulkOps, { ordered: false });
      inserted = result.upsertedCount || 0;
    } catch (bulkErr) {
      if (bulkErr.name === "MongoBulkWriteError" && bulkErr.result) {
        inserted =
          bulkErr.result.upsertedCount || bulkErr.result.nInserted || 0;
      } else {
        throw bulkErr;
      }
    }

    res.json({ inserted, scored, total: jobs.length });
  } catch (err) {
    next(err);
  }
});

// POST /api/score-preview
// Body: { title, company, location, description }
// Lightweight scorer used by the autofiller userscript's red/green bulb.
app.post("/api/score-preview", (req, res) => {
  try {
    const b = req.body || {};
    const result = scoreJob({
      title:       String(b.title       || "").slice(0, 300),
      company:     String(b.company     || "").slice(0, 200),
      location:    String(b.location    || "").slice(0, 200),
      region:      String(b.location    || "").slice(0, 200),
      description: String(b.description || "").slice(0, 20000),
    });
    res.json(result);
  } catch (e) {
    console.error("[SCORE-PREVIEW] failed:", e.message);
    res.status(500).json({ error: "Score failed" });
  }
});

// POST /api/jobs/enrich
// Body: { url, title, company, location, description }
// Called by the autofiller bulb. Finds the job by URL, updates its
// description, re-scores it, and writes the fresh score back to the DB.
app.post("/api/jobs/enrich", async (req, res) => {
  try {
    const b = req.body || {};
    const url = String(b.url || "").trim();
    const description = String(b.description || "").slice(0, 20000);
    if (!url || description.length < 100) {
      return res.status(400).json({ error: "url and description required" });
    }

    const job = await Job.findOne({ url: url });
    if (!job) {
      return res.json({ matched: false });
    }

    const hadDesc = job.description && job.description.length > 200;
    job.description = description;
    if (!hadDesc) {
      const scoring = scoreJob(job);
      job.score = scoring.score;
      job.status = scoring.status;
      job.matchedRules = scoring.matchedRules;
    }
    job.fetchedAt = new Date();
    await job.save();

    res.json({
      matched: true,
      rescored: !hadDesc,
      score: job.score,
      status: job.status,
    });
  } catch (err) {
    console.error("[ENRICH] failed:", err.message);
    res.status(500).json({ error: "Enrich failed" });
  }
});

app.post("/api/scrape", async (_req, res, next) => {
  try {
    const result = await runAllScrapers();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.get("/api/scrape/status", (req, res) => {
  res.json(getScrapeProgress());
});

app.patch("/api/jobs/:id/click", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid job ID" });
    }
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      { isClicked: true },
      { new: true },
    );
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

app.patch("/api/jobs/:id/status", async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: "Invalid job ID" });
    }
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: "Status is required" });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}`,
      });
    }
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      { status, workerStatus: status },
      { new: true },
    );
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    if (job.assignedWorkerId) {
      await Worker.updateOne(
        { workerId: job.assignedWorkerId },
        { $set: { lastActive: new Date() } },
      );
    }
    res.json(job);
  } catch (err) {
    next(err);
  }
});

app.post("/api/jobs/rescore-all", async (req, res, next) => {
  try {
    const force = req.query.force === "true" || req.body?.force === true;

    const query = force
      ? {}
      : { $or: [{ score: null }, { score: { $exists: false } }] };

    const totalCandidates = await Job.countDocuments(query);
    if (totalCandidates === 0) {
      return res.json({ message: "No unscored jobs found.", rescored: 0 });
    }

    console.log(
      `[RESCORE] Starting rescore for ${totalCandidates} jobs (force=${force})...`,
    );

    const projection = {
      _id: 1,
      title: 1,
      company: 1,
      location: 1,
      region: 1,
      description: 1,
      notes: 1,
    };
    const jobs = await Job.find(query, projection).lean();

    const BATCH_SIZE = 500;
    let rescored = 0;
    let failed = 0;
    let currentBatch = [];

    async function flushBatch() {
      if (currentBatch.length === 0) return;
      try {
        await Job.bulkWrite(currentBatch, { ordered: false });
        rescored += currentBatch.length;
        console.log(`[RESCORE] Progress: ${rescored}/${jobs.length}`);
      } catch (err) {
        if (err.name === "MongoBulkWriteError" && err.result) {
          rescored += err.result.modifiedCount || err.result.nModified || 0;
          failed += currentBatch.length - (err.result.modifiedCount || 0);
        } else {
          console.error(`[RESCORE] Batch failed: ${err.message}`);
          failed += currentBatch.length;
        }
      }
      currentBatch = [];
    }

    for (const job of jobs) {
      let scoring;
      try {
        scoring = scoreJob(job);
      } catch (scoreErr) {
        console.error(
          `[RESCORE] scoreJob failed on _id=${job._id}: ${scoreErr.message}`,
        );
        failed++;
        continue;
      }

      currentBatch.push({
        updateOne: {
          filter: { _id: job._id },
          update: {
            $set: {
              score: scoring.score,
              status: scoring.status,
              matchedRules: scoring.matchedRules,
            },
          },
        },
      });

      if (currentBatch.length >= BATCH_SIZE) {
        await flushBatch();
      }
    }

    await flushBatch();

    console.log(`[RESCORE] Done: ${rescored} rescored, ${failed} failed`);
    res.json({
      message: `Rescored ${rescored} jobs.`,
      rescored,
      failed,
      total: totalCandidates,
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/jobs/purge", async (_req, res, next) => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await Job.deleteMany({
      status: "Pending",
      scrapedAt: { $lt: sevenDaysAgo },
    });
    res.json({ purged: result.deletedCount });
  } catch (err) {
    next(err);
  }
});

app.get("/api/scrape/logs", (_req, res) => {
  try {
    const sessions = getAllSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: "Failed to read scrape logs" });
  }
});

app.post("/api/jobs/dedup-cross-run", async (_req, res, next) => {
  try {
    console.log("[API] Cross-run dedup started");
    const pendingJobs = await Job.find({ status: "Pending" }).lean();
    console.log(
      `[API] Fetched ${pendingJobs.length} Pending jobs for cross-run dedup`,
    );

    if (pendingJobs.length < 2) {
      return res.json({
        evaluated: pendingJobs.length,
        flagged: 0,
        message: "Not enough pending jobs to deduplicate",
      });
    }

    const companyGroups = groupByCompany(pendingJobs);
    const flaggedIds = [];

    for (const group of companyGroups) {
      if (group.length < 2) continue;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const sim = titleSimilarity(group[i].title, group[j].title);
          if (sim >= 0.96) {
            const rankI = getSourceRank(group[i].url);
            const rankJ = getSourceRank(group[j].url);
            let toFlag;
            if (rankI !== rankJ) {
              toFlag = rankI > rankJ ? group[i] : group[j];
            } else {
              toFlag =
                group[i].scrapedAt > group[j].scrapedAt ? group[i] : group[j];
            }
            if (!flaggedIds.includes(toFlag._id.toString())) {
              flaggedIds.push(toFlag._id.toString());
            }
          }
        }
      }
    }

    console.log(
      `[API] Similarity pass: ${flaggedIds.length} duplicate IDs found`,
    );

    let flagged = 0;
    if (flaggedIds.length > 0) {
      const bulkOps = flaggedIds.map((id) => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { status: "Duplicate" } },
        },
      }));

      const result = await Job.bulkWrite(bulkOps, { ordered: false });
      flagged = result.modifiedCount || 0;
      console.log(
        `[API] Cross-run dedup bulkWrite: ${flagged} marked Duplicate`,
      );
    }

    res.json({
      evaluated: pendingJobs.length,
      flagged,
      message: `Evaluated ${pendingJobs.length} jobs, flagged ${flagged} as duplicates`,
    });
  } catch (err) {
    console.error(`[API] Cross-run dedup failed: ${err.message}`);
    next(err);
  }
});

const workerRoutes = require("./routes/workers");

app.use("/api/indeed", indeedRouter);
app.use("/api/glassdoor", glassdoorRouter);
app.use("/api/careerbuilder", careerbuilderRouter);
app.use("/api/dice", diceRouter);
app.use("/api/simplyhired", simplyhiredRouter);
app.use("/api/linkedin", linkedinRouter);
app.use("/api/workers", workerRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
  console.error("[ERROR]", err.stack || err.message);
  res.status(500).json({ error: "Internal server error" });
});

const cronTask = cron.schedule(
  "0 7 * * *",
  async () => {
    const ts = new Date().toISOString();
    console.log(`[CRON] Cron triggered scraper run at ${ts}`);
    try {
      await runAllScrapers();
    } catch (err) {
      console.error("[CRON] Scheduled scrape failed:", err.message);
    }
  },
  { timezone: CRON_TIMEZONE },
);

async function start() {
  await initLogger();
  await connectDB();
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    console.log(`Cron scheduled for 7:00 AM (${CRON_TIMEZONE})`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[SHUTDOWN] Received ${signal}. Closing gracefully...`);
    cronTask.stop();
    server.close();
    try {
      await mongoose.connection.close();
      console.log("[SHUTDOWN] MongoDB connection closed");
    } catch (err) {
      console.error("[SHUTDOWN] Error closing MongoDB:", err.message);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();