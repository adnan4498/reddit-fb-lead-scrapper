const express = require("express");
const mongoose = require("mongoose");
const Worker = require("../models/Worker");
const Job = require("../models/Job");

const router = express.Router();

const WORKER_COLORS = [
  "#6c5ce7",
  "#00b894",
  "#0984e3",
  "#e17055",
  "#fdcb6e",
  "#a29bfe",
  "#fd79a8",
  "#00cec9",
];
const WORKER_NAMES = [
  "Alpha",
  "Bravo",
  "Charlie",
  "Delta",
  "Echo",
  "Foxtrot",
  "Golf",
  "Hotel",
  "India",
  "Juliet",
];

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

router.post("/init", async (req, res) => {
  try {
    const { workerId: existingId, isAdmin } = req.body || {};
    if (isAdmin) {
      return res.json({ mode: "admin" });
    }
    if (existingId) {
      let worker = await Worker.findOne({ workerId: existingId });
      if (worker) {
        worker.lastActive = new Date();
        await worker.save();
        return res.json(worker.toObject());
      }
    }
    const count = await Worker.countDocuments();
    const workerId = "worker-" + (count + 1);
    const color = WORKER_COLORS[count % WORKER_COLORS.length];
    const name =
      WORKER_NAMES[count % WORKER_NAMES.length] + " " + (count + 1);
    const worker = await Worker.create({
      workerId,
      name,
      color,
      lastActive: new Date(),
    });
    res.json(worker.toObject());
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/claim-jobs", async (req, res) => {
  try {
    const { workerId } = req.body || {};
    if (!workerId) return res.status(400).json({ error: "workerId required" });
    const worker = await Worker.findOne({ workerId });
    if (!worker)
      return res
        .status(404)
        .json({ error: "Worker not found. Call /api/workers/init first." });

    await Job.updateMany(
      {
        assignedWorkerId: { $ne: null },
        assignedAt: { $lt: new Date(Date.now() - 15 * 60 * 1000) },
        $or: [
          { workerStatus: "Select Status" },
          { workerStatus: "Pending" },
          { workerStatus: "" },
          { workerStatus: null },
          { workerStatus: { $exists: false } },
        ],
      },
      {
        $set: {
          assignedWorkerId: null,
          assignedAt: null,
          workerStatus: "",
          status: "Select Status",
        },
      }
    );

    const existingJobs = await Job.find({
      assignedWorkerId: workerId,
      $or: [
        { workerStatus: "Select Status" },
        { status: "Select Status" },
        { workerStatus: "" },
        { workerStatus: null },
        { workerStatus: { $exists: false } },
        { workerStatus: "Pending" },
      ],
    })
      .sort({ score: -1 })
      .lean();

    if (existingJobs.length > 0) {
      worker.lastActive = new Date();
      await worker.save();
      return res.json({ jobs: existingJobs, claimed: existingJobs.length, assignedRange: worker.assignedRange || null });
    }

    const unassignedCount = await Job.countDocuments({
      assignedWorkerId: null,
      status: {
        $nin: ["DISCARD", "Duplicate", "Applied", "Rejected", "Archived"],
      },
      $or: [{ workerStatus: "" }, { workerStatus: { $exists: false } }],
    });

    if (unassignedCount === 0) return res.json({ jobs: [], claimed: 0, assignedRange: null });

    const workerCount = await Worker.countDocuments();
    const claimLimit = Math.min(Math.ceil(unassignedCount / Math.max(1, workerCount)), 100);

    const jobs = await Job.find({
      assignedWorkerId: null,
      status: {
        $nin: ["DISCARD", "Duplicate", "Applied", "Rejected", "Archived"],
      },
      $or: [{ workerStatus: "" }, { workerStatus: { $exists: false } }],
    })
      .sort({ score: -1 })
      .limit(claimLimit)
      .lean();

    if (jobs.length === 0) return res.json({ jobs: [], claimed: 0, assignedRange: null });

    const ids = jobs.map((j) => j._id);

    const existingAssigned = await Job.countDocuments({
      assignedWorkerId: { $ne: null },
    });

    await Job.updateMany(
      { _id: { $in: ids }, assignedWorkerId: null },
      {
        $set: {
          assignedWorkerId: workerId,
          assignedAt: new Date(),
          workerStatus: "Pending",
        },
      }
    );

    const rangeStart = existingAssigned + 1;
    const rangeEnd = existingAssigned + jobs.length;
    const assignedRange = "#" + rangeStart + "-#" + rangeEnd;

    worker.totalClaimed += jobs.length;
    worker.assignedJobCount = jobs.length;
    worker.assignedRange = assignedRange;
    worker.lastActive = new Date();
    await worker.save();

    const updatedJobs = await Job.find({ _id: { $in: ids } })
      .sort({ score: -1 })
      .lean();
    res.json({ jobs: updatedJobs, claimed: updatedJobs.length, assignedRange });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/return-jobs", async (req, res) => {
  try {
    const { workerId } = req.body || {};
    if (!workerId) return res.status(400).json({ error: "workerId required" });
    
    const worker = await Worker.findOne({ workerId });
    if (!worker) return res.status(404).json({ error: "Worker not found." });

    const result = await Job.updateMany(
      {
        assignedWorkerId: workerId,
        $or: [
          { workerStatus: "Select Status" },
          { workerStatus: "Pending" },
          { workerStatus: "" },
          { workerStatus: null },
          { workerStatus: { $exists: false } },
        ],
      },
      {
        $set: {
          assignedWorkerId: null,
          assignedAt: null,
          workerStatus: "",
          status: "Select Status",
        },
      }
    );

    const remainingAssigned = await Job.countDocuments({ assignedWorkerId: workerId });
    worker.assignedJobCount = remainingAssigned;
    worker.lastActive = new Date();
    await worker.save();

    res.json({ returnedCount: result.modifiedCount, remainingAssigned });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});


router.post("/distribute-all", async (_req, res) => {
  try {
    const unassignedJobs = await Job.find({
      assignedWorkerId: null,
      status: {
        $nin: ["DISCARD", "Duplicate", "Applied", "Rejected", "Archived"],
      },
      $or: [{ workerStatus: "" }, { workerStatus: { $exists: false } }],
    })
      .sort({ score: -1 })
      .lean();

    const workers = await Worker.find({}).lean();
    if (!workers.length) return res.json({ assignedTotal: 0, workerCount: 0 });

    let assignedTotal = 0;
    let jobIdx = 0;

    for (const worker of workers) {
      const bucket = unassignedJobs.slice(jobIdx, jobIdx + 100);
      if (!bucket.length) break;
      jobIdx += bucket.length;

      const ids = bucket.map((j) => j._id);
      await Job.updateMany(
        { _id: { $in: ids } },
        {
          $set: {
            assignedWorkerId: worker.workerId,
            assignedAt: new Date(),
            workerStatus: "Select Status",
          },
        }
      );
      await Worker.updateOne(
        { workerId: worker.workerId },
        {
          $inc: { totalClaimed: bucket.length, assignedJobCount: bucket.length },
          $set: { lastActive: new Date() },
        }
      );
      assignedTotal += bucket.length;
    }

    res.json({ assignedTotal, workerCount: workers.length });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/assign-manual", async (req, res) => {
  try {
    const { workerId, count } = req.body || {};
    if (!workerId || !count) return res.status(400).json({ error: "workerId and count required" });
    const limit = Math.min(parseInt(count, 10) || 100, 100);

    const worker = await Worker.findOne({ workerId });
    if (!worker) return res.status(404).json({ error: "Worker not found." });

    const jobs = await Job.find({
      assignedWorkerId: null,
      status: {
        $nin: ["DISCARD", "Duplicate", "Applied", "Rejected", "Archived"],
      },
      $or: [{ workerStatus: "" }, { workerStatus: { $exists: false } }],
    })
      .sort({ score: -1 })
      .limit(limit)
      .lean();

    if (!jobs.length) return res.json({ claimed: 0 });

    const ids = jobs.map((j) => j._id);
    await Job.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          assignedWorkerId: workerId,
          assignedAt: new Date(),
          workerStatus: "Select Status",
        },
      }
    );

    worker.totalClaimed += jobs.length;
    worker.assignedJobCount += jobs.length;
    worker.lastActive = new Date();
    await worker.save();

    res.json({ claimed: jobs.length });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const workerId = req.params.id;
    const worker = await Worker.findOne({ workerId });
    if (!worker) return res.status(404).json({ error: "Worker not found." });

    await Job.updateMany(
      { assignedWorkerId: workerId },
      {
        $set: {
          assignedWorkerId: null,
          assignedAt: null,
          workerStatus: "",
          status: "Select Status",
        },
      }
    );

    await Worker.deleteOne({ workerId });

    res.json({ deleted: true, workerId });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/stats", async (_req, res) => {
  try {
    const workers = await Worker.find({}).sort({ lastActive: -1 }).lean();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const results = [];
    for (const w of workers) {
      const agg = await Job.aggregate([
        { $match: { assignedWorkerId: w.workerId, assignedAt: { $gte: today } } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]);
      const counts = {
        Pending: 0,
        Applied: 0,
        Interviewing: 0,
        Offered: 0,
        Rejected: 0,
        Archived: 0,
        Duplicate: 0,
        "Manual Review": 0,
        Skipped: 0,
      };
      for (const a of agg) {
        if (counts.hasOwnProperty(a._id)) counts[a._id] = a.count;
      }
      const assignedCount = await Job.countDocuments({
        assignedWorkerId: w.workerId,
      });
      const completedCount = await Job.countDocuments({
        assignedWorkerId: w.workerId,
        status: {
          $nin: ["Select Status", "Pending", "", null],
        },
      });
      results.push({
        ...w,
        todayCounts: counts,
        totalToday: Object.values(counts).reduce((a, b) => a + b, 0),
        assignedCount,
        completedCount,
      });
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/reset", async (_req, res) => {
  try {
    const workerResult = await Worker.deleteMany({});
    const jobResult = await Job.updateMany(
      { assignedWorkerId: { $ne: null } },
      {
        $set: {
          assignedWorkerId: null,
          assignedAt: null,
          workerStatus: "",
        },
      }
    );
    res.json({
      deletedWorkers: workerResult.deletedCount,
      resetJobs: jobResult.modifiedCount,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
