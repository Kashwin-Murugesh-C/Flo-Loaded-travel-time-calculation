const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema({
  sessionId: String,
  robotId: String,
  session_start: String,
  trip_start: String,
  trip_end: String,
  duration_s: Number,
  distance: Number,
  raw_odo_delta: Number,
  avg_speed: Number,
  stopped_time_s: Number,
  payload: Number,
  glitches_removed: Number,
  flags: String,
  is_incomplete: Boolean
}, { _id: false });

const sampleSchema = new mongoose.Schema({
  timestamp: String,
  t_epoch: Number,
  distance: Number,
  payload: Number,
  voltage: Number,
  current: Number,
  percentage: Number,
  mmrVoltage: Number,
  mmrCurrent: Number,
  mmrPower: Number
}, { _id: false });

const robotSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  robotId: { type: String, index: true },
  name: String,
  start: { type: Date, required: true, index: true },
  end: { type: Date, required: true, index: true },
  distanceTravelled: { type: Number, default: 0 },
  operationTime: { type: Number, default: 0 },
  energyConsumed: { type: Number, default: 0 },
  sampleCount: { type: Number, default: 0 },
  tripsCount: { type: Number, default: 0 },
  trips: [tripSchema],
  samples: [sampleSchema]
}, { timestamps: true });

robotSessionSchema.index({ start: 1, end: 1 });

module.exports = mongoose.model('RobotSession', robotSessionSchema);
