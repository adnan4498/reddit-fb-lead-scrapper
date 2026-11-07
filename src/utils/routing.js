'use strict';

function determineJobStatus(url) {
  if (!url) return 'Manual Review';
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('greenhouse.io') || lowerUrl.includes('lever.co') || lowerUrl.includes('ashbyhq.com')) {
    return 'Pending';
  }
  return 'Manual Review';
}

module.exports = { determineJobStatus };
