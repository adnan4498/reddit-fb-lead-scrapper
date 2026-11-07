const mongoose = require('mongoose');

const STATUS_ENUM = [
  'Select Status', 'Pending', 'Manual Review',
  'TIER_1_HIGH', 'TIER_2_MEDIUM', 'TIER_3_LOW', 'DISCARD',
  'Applied', 'Interviewing', 'Offered', 'Rejected', 'Archived', 'Duplicate',
  'Skipped',
];

const jobSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    company: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    region: {
      type: String,
      default: 'Remote',
      trim: true,
    },
    platformSource: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: STATUS_ENUM,
      default: 'Pending',
    },
    isClicked: {
      type: Boolean,
      default: false,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    // ---- NEW: store the actual apply link (external) ----
    applyUrl: {
      type: String,
      trim: true,
      default: null,
    },
    scrapedAt: {
      type: Date,
      default: Date.now,
    },
    slug: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      trim: true,
    },
    rawId: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    countryCode: {
      type: String,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      default: '',
    },
    salary: {
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      currency: { type: String, default: null },
    },
    postedAt: {
      type: Date,
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
    score: {
      type: Number,
      default: 0,
    },
    matchedRules: {
      type: [String],
      default: [],
    },
    assignedWorkerId: {
      type: String,
      default: null,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    workerStatus: {
      type: String,
      enum: ['Pending', 'Applied', 'In Review', 'Skipped', 'Rejected', ''],
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

jobSchema.index({ url: 1 }, { unique: true });
jobSchema.index({ slug: 1 }, { unique: true });
jobSchema.index(
  { scrapedAt: 1 },
  {
    expireAfterSeconds: 7 * 24 * 60 * 60,
    partialFilterExpression: { status: 'Pending' },
  }
);

jobSchema.index({ company: 1, scrapedAt: -1 });
jobSchema.index({ title: 1, company: 1 });

module.exports = mongoose.model('Job', jobSchema);