'use strict';

// Lightweight in-process FIFO queue that decouples job-data ingestion from the
// HTTP request/response cycle. Payloads are processed sequentially in the
// background so the scraping loop never blocks on dedup, scoring, LLM, or
// MongoDB bulk operations.

const queue = [];
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const task = queue.shift();
    try {
      await task();
    } catch (err) {
      console.error(
        '[INGEST-QUEUE] task failed: ' + (err && err.message ? err.message : err),
      );
    }
  }
  draining = false;
}

function enqueue(task) {
  queue.push(task);
  void drain();
}

function stats() {
  return { queued: queue.length, processing: draining ? 1 : 0 };
}

module.exports = { enqueue, stats };
