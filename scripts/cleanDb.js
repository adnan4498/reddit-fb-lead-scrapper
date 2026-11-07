const mongoose = require('mongoose');
const Job = require('../src/models/Job');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI;

async function cleanDatabase() {
  if (!MONGO_URI) {
    console.error('Error: MONGO_URI is not defined in your .env file.');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log('MongoDB connected successfully for cleanup.');

    const targetStatuses = ["Failed - Unexpected Error", "Failed - No form elements found", "Applied"];

    // Step 1: Find the old failed jobs that belong to direct ATS platforms and mark them 'Pending'
    const atsResult = await Job.updateMany(
      {
        status: { $in: targetStatuses },
        $or: [
          { url: /greenhouse\.io/i },
          { url: /lever\.co/i },
          { url: /ashbyhq\.com/i }
        ]
      },
      { $set: { status: 'Pending' } }
    );
    console.log(`Successfully reset ${atsResult.modifiedCount} ATS jobs back to Pending.`);

    // Step 2: Mark all other remaining target failed jobs as 'Manual Review'
    const manualResult = await Job.updateMany(
      { status: { $in: targetStatuses } },
      { $set: { status: 'Manual Review' } }
    );
    console.log(`Successfully moved ${manualResult.modifiedCount} aggregator jobs to Manual Review.`);

  } catch (error) {
    console.error('Error during database cleanup:', error);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
    process.exit(0);
  }
}

cleanDatabase();
