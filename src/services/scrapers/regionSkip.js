'use strict';

// Tracks consecutive "empty" regions (regions that yielded no new jobs) so a
// fetcher can stop early once a keyword is clearly exhausted across regions,
// instead of hammering every remaining region with duplicate results.

const DEFAULT_THRESHOLD = 3;

function createRegionSkipTracker(threshold = DEFAULT_THRESHOLD) {
  let consecutiveEmpty = 0;

  return {
    // Call once after finishing each region. Pass true when the region
    // produced at least one new job, false otherwise. Returns true when the
    // remaining regions should be skipped.
    onRegionDone(regionHadNewJobs) {
      if (regionHadNewJobs) {
        consecutiveEmpty = 0;
        return false;
      }
      consecutiveEmpty += 1;
      if (consecutiveEmpty >= threshold) {
        console.log(
          '[SKIP] ' +
            consecutiveEmpty +
            ' consecutive regions returned no new jobs — skipping remaining regions',
        );
        return true;
      }
      return false;
    },
  };
}

module.exports = { createRegionSkipTracker };
