/**
 * Seed script: imports CSV/JSONL data into MongoDB.
 * Deduplicates sessions_summary on (start, end, distanceTravelled, operationTime).
 * Extracts odometer samples from sessions.jsonl into their own collection.
 *
 * Usage: node server/scripts/seed.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const readline = require('readline');

const SessionSummary = require('../models/SessionSummary');
const OdometerSample = require('../models/OdometerSample');
const Trip = require('../models/Trip');

const DATA_DIR = path.join(__dirname, '../../data');

async function seedSessionsSummary() {
  console.log('📊 Importing sessions_summary.csv...');
  const raw = fs.readFileSync(path.join(DATA_DIR, 'sessions_summary.csv'), 'utf-8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });

  console.log(`   Raw rows: ${records.length}`);

  // Deduplicate on (start, end, distanceTravelled, operationTime)
  const seen = new Map();
  const unique = [];
  for (const r of records) {
    const key = `${r.start}|${r.end}|${r.distanceTravelled}|${r.operationTime}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      unique.push({
        sessionId: r.sessionId,
        name: r.name,
        start: new Date(r.start),
        end: new Date(r.end),
        distanceTravelled: parseFloat(r.distanceTravelled) || 0,
        operationTime: parseFloat(r.operationTime) || 0,
        energyConsumed: parseFloat(r.energyConsumed) || 0,
        nDistance: parseInt(r.nDistance) || 0,
        nBattery: parseInt(r.nBattery) || 0,
        nPayloadWeight: parseInt(r.nPayloadWeight) || 0,
        nMmr: parseInt(r.nMmr) || 0,
        nImu: parseInt(r.nImu) || 0,
        nGnss: parseInt(r.nGnss) || 0,
        nAltitude: parseInt(r.nAltitude) || 0,
        nPerf: parseInt(r.nPerf) || 0,
        nVideos: parseInt(r.nVideos) || 0,
        batteryErrorCount: parseInt(r.batteryErrorCount) || 0,
        dedupKey: key
      });
    }
  }
  console.log(`   After dedup: ${unique.length}`);

  await SessionSummary.deleteMany({});
  await SessionSummary.insertMany(unique, { ordered: false });
  console.log(`   ✅ Inserted ${unique.length} session summaries`);
}

async function seedOdometerSamples() {
  console.log('📡 Importing odometer samples from sessions.jsonl...');
  const filePath = path.join(DATA_DIR, 'sessions.jsonl');
  const fileStream = fs.createReadStream(filePath, 'utf-8');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  await OdometerSample.deleteMany({});

  let totalSamples = 0;
  let sessionCount = 0;
  let batch = [];
  const BATCH_SIZE = 5000;

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const session = JSON.parse(line);
      const sessionId = (session.sessionInfo && session.sessionInfo.id) || session._id || ('session-' + sessionCount);
      const distArr = session.distance || [];

      sessionCount++;

      for (const entry of distArr) {
        batch.push({
          sessionId,
          timestamp: new Date(entry.timestamp),
          odometer_m: parseFloat(entry.data) || 0
        });

        if (batch.length >= BATCH_SIZE) {
          await OdometerSample.insertMany(batch, { ordered: false });
          totalSamples += batch.length;
          batch = [];
        }
      }
    } catch (e) {
      console.warn(`   ⚠️ Skipping malformed line: ${e.message}`);
    }
  }

  if (batch.length > 0) {
    await OdometerSample.insertMany(batch, { ordered: false });
    totalSamples += batch.length;
  }

  console.log(`   ✅ Inserted ${totalSamples} odometer samples from ${sessionCount} sessions`);
}

async function seedTrips() {
  console.log('🚛 Importing trips.csv...');
  const raw = fs.readFileSync(path.join(DATA_DIR, 'trips.csv'), 'utf-8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });

  console.log(`   Raw rows: ${records.length}`);

  const trips = records.map(r => ({
    tripId: r.sessionId, // trip's sessionId field is the trip ID
    operatorId: r.operatorId,
    operatorName: r.operatorName,
    clientId: r.clientId,
    timestamp: r.timestamp ? new Date(r.timestamp) : null,
    tripStart: r.tripStart ? new Date(r.tripStart) : null,
    tripEnd: r.tripEnd ? new Date(r.tripEnd) : null,
    loadingStart: r.loadingStart ? new Date(r.loadingStart) : null,
    loadingEnd: r.loadingEnd ? new Date(r.loadingEnd) : null,
    unloadingStart: r.unloadingStart ? new Date(r.unloadingStart) : null,
    unloadingEnd: r.unloadingEnd ? new Date(r.unloadingEnd) : null,
    returnTripStart: r.returnTripStart ? new Date(r.returnTripStart) : null,
    returnTripEnd: r.returnTripEnd ? new Date(r.returnTripEnd) : null,
    tripRunningTime: parseFloat(r.tripRunningTime) || 0,
    tripIdleTime: parseFloat(r.tripIdleTime) || 0,
    totalDownTime: parseFloat(r.totalDownTime) || 0,
    typeOfMaterial: r.typeOfMaterial || '',
    quantity: parseFloat(r.quantity) || 0,
    loadingWorkers: parseInt(r.loadingWorkers) || 0,
    unloadingWorkers: parseInt(r.unloadingWorkers) || 0,
    isActuatorUsed: r.isActuatorUsed === 'true'
  }));

  await Trip.deleteMany({});
  await Trip.insertMany(trips, { ordered: false });
  console.log(`   ✅ Inserted ${trips.length} trips`);
}

async function runSeed() {
  const summaryRes = await seedSessionsSummary();
  const odoRes = await seedOdometerSamples();
  const tripsRes = await seedTrips();
  return { success: true };
}

if (require.main === module) {
  mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/mmr132')
    .then(async () => {
      console.log('🔌 Connected to MongoDB\n');
      await runSeed();
      console.log('\n🎉 Seed complete!');
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Seed failed:', err);
      process.exit(1);
    });
}

module.exports = { runSeed, seedSessionsSummary, seedOdometerSamples, seedTrips };

