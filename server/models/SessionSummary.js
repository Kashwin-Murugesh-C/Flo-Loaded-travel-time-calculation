const mongoose = require('mongoose');

const sessionSummarySchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  name: String,
  start: { type: Date, required: true, index: true },
  end: { type: Date, required: true, index: true },
  distanceTravelled: { type: Number, default: 0 },
  operationTime: { type: Number, default: 0 },       // ms
  energyConsumed: { type: Number, default: 0 },
  nDistance: Number,
  nBattery: Number,
  nPayloadWeight: Number,
  nMmr: Number,
  nImu: Number,
  nGnss: Number,
  nAltitude: Number,
  nPerf: Number,
  nVideos: Number,
  batteryErrorCount: Number,
  dedupKey: { type: String, unique: true, index: true } // start+end+dist+opTime
});

// Compound index for time-overlap queries
sessionSummarySchema.index({ start: 1, end: 1 });

module.exports = mongoose.model('SessionSummary', sessionSummarySchema);
