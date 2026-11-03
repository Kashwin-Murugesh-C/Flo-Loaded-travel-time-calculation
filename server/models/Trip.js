const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema({
  tripId: { type: String, required: true, unique: true, index: true }, // sessionId from trips.csv
  operatorId: String,
  operatorName: { type: String, index: true },
  clientId: String,
  timestamp: Date,
  tripStart: Date,
  tripEnd: Date,
  loadingStart: Date,
  loadingEnd: { type: Date, index: true },
  unloadingStart: { type: Date, index: true },
  unloadingEnd: Date,
  returnTripStart: Date,
  returnTripEnd: Date,
  tripRunningTime: Number,
  tripIdleTime: Number,
  totalDownTime: Number,
  typeOfMaterial: { type: String, index: true },
  quantity: Number,
  loadingWorkers: Number,
  unloadingWorkers: Number,
  isActuatorUsed: Boolean
});

tripSchema.index({ loadingEnd: 1, unloadingStart: 1 });

module.exports = mongoose.model('Trip', tripSchema);
