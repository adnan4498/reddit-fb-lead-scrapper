const mongoose = require('mongoose');

const workerSchema = new mongoose.Schema({
  workerId: { type: String, required: true },
  name: { type: String, required: true },
  color: { type: String, default: '#6c5ce7' },
  lastActive: { type: Date, default: Date.now },
  totalClaimed: { type: Number, default: 0 },
  totalApplied: { type: Number, default: 0 },
  totalSkipped: { type: Number, default: 0 },
  totalRejected: { type: Number, default: 0 },
  assignedRange: { type: String, default: '' },
  assignedJobCount: { type: Number, default: 0 },
}, { timestamps: true });

workerSchema.index({ workerId: 1 }, { unique: true });

module.exports = mongoose.model('Worker', workerSchema);
