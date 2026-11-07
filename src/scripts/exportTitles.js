require('dotenv').config();
const fs = require('fs');
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function exportTitles() {
  if (!MONGO_URI) {
    console.error('Error: MONGODB_URI or MONGO_URI is missing in your .env file');
    process.exit(1);
  }

  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);

    const db = mongoose.connection.db;
    const jobsCollection = db.collection('jobs');

    console.log('Fetching unique job titles...');
    const rawTitles = await jobsCollection.distinct('title');

    // Clean up empty lines and sort alphabetically
    const titles = rawTitles
      .filter(Boolean)
      .map(t => t.trim())
      .filter(t => t.length > 0)
      .sort();

    const outputPath = './titles.txt';
    fs.writeFileSync(outputPath, titles.join('\n'), 'utf-8');

    console.log(`\nDone! Saved ${titles.length} unique titles to ${outputPath}`);
  } catch (err) {
    console.error('Failed to export titles:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit();
  }
}

exportTitles();