const mongoose = require('mongoose');

const tripMetricSchema = new mongoose.Schema({
  tripId: { type: String, required: true, unique: true, index: true },

  // Inputs
  loadingEnd: Date,
  unloadingStart: Date,
  operatorName: String,
  typeOfMaterial: String,

  // Computed outputs
  loadedTimeSec: Number,
  measuredDistance: Number,       // metres, from odometer deltas
  estimatedDistance: Number,      // metres, from session summary fallback
  coverage: Number,              // 0..1
  status: {                      // measured | partial | no_data | invalid_window
    type: String,
    enum: ['measured', 'partial', 'no_data', 'invalid_window'],
    index: true
  },
  avgSpeedMps: Number,           // only when status=measured

  // Audit
  sessionIds: [String],          // robot sessions overlapping the window
  sampleCount: Number,           // odometer samples used
  computedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('TripMetric', tripMetricSchema);
