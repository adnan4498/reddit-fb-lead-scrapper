let progress = {
  total: 0,
  processed: 0,
  inserted: 0,
  duplicates: 0,
  excluded: 0,
  errors: 0,
  status: 'idle', // idle, running, complete, error
  startedAt: null,
  completedAt: null
};

function updateScrapeProgress(data) {
  progress = { ...progress, ...data };
}

function getScrapeProgress() {
  return progress;
}

function resetScrapeProgress() {
  progress = {
    total: 0,
    processed: 0,
    inserted: 0,
    duplicates: 0,
    excluded: 0,
    errors: 0,
    status: 'idle',
    startedAt: null,
    completedAt: null
  };
}

module.exports = { updateScrapeProgress, getScrapeProgress, resetScrapeProgress };