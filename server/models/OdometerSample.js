const mongoose = require('mongoose');

const odometerSampleSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  timestamp: { type: Date, required: true },
  odometer_m: { type: Number, required: true }
}, { _id: true });

// Compound index for efficient window queries
odometerSampleSchema.index({ sessionId: 1, timestamp: 1 });
odometerSampleSchema.index({ timestamp: 1 });

module.exports = mongoose.model('OdometerSample', odometerSampleSchema);
