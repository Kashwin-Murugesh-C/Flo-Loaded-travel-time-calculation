const express = require('express');
const router = express.Router();
const Trip = require('../models/Trip');
const TripMetric = require('../models/TripMetric');
const SessionSummary = require('../models/SessionSummary');
const OdometerSample = require('../models/OdometerSample');
const RobotSession = require('../models/RobotSession');
const { computeTripMetrics } = require('../services/tripMetrics');
const { seedRobotSessions } = require('../services/sessionTripService');

/**
 * POST /api/metrics/recompute
 * Recompute all trip metrics (idempotent).
 */
router.post('/metrics/recompute', async (req, res) => {
  try {
    const trips = await Trip.find({}).lean();
    const sessions = await SessionSummary.find({}).lean();

    // Pre-process sessions into the format the service expects
    const sessionList = sessions.map(s => ({
      sessionId: s.sessionId,
      start: new Date(s.start).getTime(),
      end: new Date(s.end).getTime(),
      distanceTravelled: s.distanceTravelled
    }));

    let computed = 0;
    let errors = 0;

    for (const trip of trips) {
      try {
        const loadingEnd = trip.loadingEnd ? new Date(trip.loadingEnd).getTime() : null;
        const unloadingStart = trip.unloadingStart ? new Date(trip.unloadingStart).getTime() : null;

        const tripData = {
          tripId: trip.tripId,
          loadingEnd,
          unloadingStart,
          operatorName: trip.operatorName,
          typeOfMaterial: trip.typeOfMaterial
        };

        // Only fetch odometer samples if we have a valid window
        var samplesBySession = {};
        if (loadingEnd && unloadingStart && unloadingStart > loadingEnd) {
          // Query odometer samples directly by timestamp window (with buffer for interpolation)
          var allSamples = await OdometerSample.find({
            timestamp: {
              $gte: new Date(loadingEnd - 60000),
              $lte: new Date(unloadingStart + 60000)
            }
          }).sort({ sessionId: 1, timestamp: 1 }).lean();

          // Group by the odometer sample's own sessionId
          for (var si = 0; si < allSamples.length; si++) {
            var s = allSamples[si];
            var sid = s.sessionId;
            if (!samplesBySession[sid]) samplesBySession[sid] = [];
            samplesBySession[sid].push({
              timestamp: new Date(s.timestamp).getTime(),
              odometer_m: s.odometer_m
            });
          }

          // Build a sessions list from the odometer data for the pure function
          // Each odometer sessionId maps to a time range we can derive from the samples
          var odometerSessionIds = Object.keys(samplesBySession);
          var odometerSessionList = odometerSessionIds.map(function(osid) {
            var samples = samplesBySession[osid];
            return {
              sessionId: osid,
              start: samples[0].timestamp,
              end: samples[samples.length - 1].timestamp,
              distanceTravelled: 0  // we don't have this for odometer sessions
            };
          });

          // Use the session summaries for estimated distance, but odometer session list for measured
          var metric = computeTripMetrics(tripData, odometerSessionList, samplesBySession);

          // Separately compute estimated distance from the summary sessions
          var overlappingSummaries = sessionList.filter(function(ss) {
            return ss.start < unloadingStart && ss.end > loadingEnd;
          });
          if (overlappingSummaries.length > 0) {
            var estDist = 0;
            for (var oi = 0; oi < overlappingSummaries.length; oi++) {
              var sess = overlappingSummaries[oi];
              var sessionDuration = sess.end - sess.start;
              if (sessionDuration <= 0) continue;
              var overlapStart = Math.max(sess.start, loadingEnd);
              var overlapEnd = Math.min(sess.end, unloadingStart);
              var overlapMs = Math.max(0, overlapEnd - overlapStart);
              estDist += (sess.distanceTravelled || 0) * (overlapMs / sessionDuration);
            }
            metric.estimatedDistance = estDist;
          }

          await TripMetric.findOneAndUpdate(
            { tripId: trip.tripId },
            Object.assign({}, metric, {
              loadingEnd: metric.loadingEnd ? new Date(metric.loadingEnd) : null,
              unloadingStart: metric.unloadingStart ? new Date(metric.unloadingStart) : null,
              computedAt: new Date()
            }),
            { upsert: true, new: true }
          );

          computed++;
          continue; // skip the default path below
        }

        var fallbackMetric = computeTripMetrics(tripData, sessionList, samplesBySession);

        await TripMetric.findOneAndUpdate(
          { tripId: trip.tripId },
          Object.assign({}, fallbackMetric, {
            loadingEnd: fallbackMetric.loadingEnd ? new Date(fallbackMetric.loadingEnd) : null,
            unloadingStart: fallbackMetric.unloadingStart ? new Date(fallbackMetric.unloadingStart) : null,
            computedAt: new Date()
          }),
          { upsert: true, new: true }
        );

        computed++;
      } catch (err) {
        console.error('Error computing metrics for trip ' + trip.tripId + ':', err.message);
        errors++;
      }
    }

    res.json({ success: true, computed, errors, total: trips.length });
  } catch (err) {
    console.error('Recompute error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/trips
 * Paginated list of trips with metrics.
 * Query params: from, to, status, operator, material, page, limit
 */
router.get('/trips', async (req, res) => {
  try {
    const {
      from, to, status, operator, material,
      page = 1, limit = 25, sortBy = 'loadingEnd', sortDir = 'desc'
    } = req.query;

    const filter = {};
    if (from || to) {
      filter.loadingEnd = {};
      if (from) filter.loadingEnd.$gte = new Date(from);
      if (to) filter.loadingEnd.$lte = new Date(to);
    }
    if (operator) filter.operatorName = { $regex: operator, $options: 'i' };
    if (material) filter.typeOfMaterial = { $regex: material, $options: 'i' };

    if (status) {
      const metricTripIds = await TripMetric.find({ status }).distinct('tripId');
      filter.tripId = { $in: metricTripIds };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

    const [trips, total] = await Promise.all([
      Trip.find(filter).sort(sortObj).skip(skip).limit(parseInt(limit)).lean(),
      Trip.countDocuments(filter)
    ]);

    // Attach metrics
    const tripIds = trips.map(t => t.tripId);
    const metrics = await TripMetric.find({ tripId: { $in: tripIds } }).lean();
    const metricsMap = {};
    for (const m of metrics) metricsMap[m.tripId] = m;

    let result = trips.map(t => ({
      ...t,
      metrics: metricsMap[t.tripId] || null
    }));

    res.json({
      trips: result,
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    console.error('Error fetching trips:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/trips/:id
 * Single trip with full detail including odometer samples for audit.
 */
router.get('/trips/:id', async (req, res) => {
  try {
    const trip = await Trip.findOne({ tripId: req.params.id }).lean();
    if (!trip) return res.status(404).json({ error: 'Trip not found' });

    const metric = await TripMetric.findOne({ tripId: req.params.id }).lean();

    // Fetch odometer samples for audit
    let odometerSamples = [];
    if (trip.loadingEnd && trip.unloadingStart) {
      const windowStart = new Date(trip.loadingEnd);
      const windowEnd = new Date(trip.unloadingStart);

      // Fetch all samples in the timeframe with buffer
      odometerSamples = await OdometerSample.find({
        timestamp: {
          $gte: new Date(windowStart.getTime() - 120000),
          $lte: new Date(windowEnd.getTime() + 120000)
        }
      }).sort({ sessionId: 1, timestamp: 1 }).lean();
    }

    res.json({ trip, metric, odometerSamples });
  } catch (err) {
    console.error('Error fetching trip:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/metrics/summary
 * Aggregate stats: totals, averages, % by status.
 */
router.get('/metrics/summary', async (req, res) => {
  try {
    const metrics = await TripMetric.find({}).lean();
    const total = metrics.length;

    if (total === 0) {
      return res.json({
        total: 0,
        byStatus: {},
        averages: {},
        totalMeasuredDistance: 0,
        totalEstimatedDistance: 0
      });
    }

    // Status breakdown
    const byStatus = {};
    for (const m of metrics) {
      byStatus[m.status] = (byStatus[m.status] || 0) + 1;
    }

    // Averages
    const measured = metrics.filter(m => m.status === 'measured');
    const withDistance = metrics.filter(m => m.measuredDistance != null);
    const withTime = metrics.filter(m => m.loadedTimeSec > 0);
    const withCoverage = metrics.filter(m => m.coverage != null);

    const avgLoadedTimeSec = withTime.length > 0
      ? withTime.reduce((a, m) => a + m.loadedTimeSec, 0) / withTime.length
      : 0;
    const avgMeasuredDistance = withDistance.length > 0
      ? withDistance.reduce((a, m) => a + m.measuredDistance, 0) / withDistance.length
      : 0;
    const avgCoverage = withCoverage.length > 0
      ? withCoverage.reduce((a, m) => a + m.coverage, 0) / withCoverage.length
      : 0;
    const avgSpeed = measured.length > 0
      ? measured.filter(m => m.avgSpeedMps).reduce((a, m) => a + m.avgSpeedMps, 0) / measured.filter(m => m.avgSpeedMps).length
      : 0;

    // By material
    const materialMap = {};
    for (const m of metrics) {
      const mat = m.typeOfMaterial || 'Unknown';
      if (!materialMap[mat]) materialMap[mat] = { count: 0, totalTime: 0, totalDist: 0 };
      materialMap[mat].count++;
      if (m.loadedTimeSec > 0) materialMap[mat].totalTime += m.loadedTimeSec;
      if (m.measuredDistance > 0) materialMap[mat].totalDist += m.measuredDistance;
    }

    // By operator
    const operatorMap = {};
    for (const m of metrics) {
      const op = m.operatorName || 'Unknown';
      if (!operatorMap[op]) operatorMap[op] = { count: 0, totalTime: 0, totalDist: 0 };
      operatorMap[op].count++;
      if (m.loadedTimeSec > 0) operatorMap[op].totalTime += m.loadedTimeSec;
      if (m.measuredDistance > 0) operatorMap[op].totalDist += m.measuredDistance;
    }

    // By day
    const dayMap = {};
    for (const m of metrics) {
      if (!m.loadingEnd) continue;
      const day = new Date(m.loadingEnd).toISOString().split('T')[0];
      if (!dayMap[day]) dayMap[day] = { count: 0, totalTime: 0, totalDist: 0 };
      dayMap[day].count++;
      if (m.loadedTimeSec > 0) dayMap[day].totalTime += m.loadedTimeSec;
      if (m.measuredDistance > 0) dayMap[day].totalDist += m.measuredDistance;
    }

    res.json({
      total,
      byStatus,
      statusPercentages: Object.fromEntries(
        Object.entries(byStatus).map(([k, v]) => [k, ((v / total) * 100).toFixed(1)])
      ),
      averages: {
        loadedTimeSec: avgLoadedTimeSec,
        measuredDistanceM: avgMeasuredDistance,
        coverage: avgCoverage,
        speedMps: avgSpeed
      },
      totalMeasuredDistance: withDistance.reduce((a, m) => a + (m.measuredDistance || 0), 0),
      totalEstimatedDistance: metrics.reduce((a, m) => a + (m.estimatedDistance || 0), 0),
      byMaterial: materialMap,
      byOperator: operatorMap,
      byDay: Object.entries(dayMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, d]) => ({
          day,
          count: d.count,
          avgTimeSec: d.count > 0 ? d.totalTime / d.count : 0,
          totalDistM: d.totalDist
        }))
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sessions
 * Paginated list of robot sessions with calculated loaded trips.
 * Query params: from, to, search, hasTrips, page, limit, sortBy, sortDir
 */
router.get('/sessions', async (req, res) => {
  try {
    const {
      from, to, search, hasTrips,
      page = 1, limit = 25, sortBy = 'start', sortDir = 'desc'
    } = req.query;

    const filter = {};
    if (from || to) {
      filter.start = {};
      if (from) {
        filter.start.$gte = new Date(from);
      }
      if (to) {
        let toDate = new Date(to);
        if (to.length === 10) {
          toDate = new Date(`${to}T23:59:59.999Z`);
        }
        filter.start.$lte = toDate;
      }
    }

    if (search) {
      filter.$or = [
        { sessionId: { $regex: search, $options: 'i' } },
        { robotId: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } }
      ];
    }

    if (hasTrips === 'true') {
      filter.tripsCount = { $gt: 0 };
    } else if (hasTrips === 'false') {
      filter.tripsCount = 0;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortObj = { [sortBy]: sortDir === 'asc' ? 1 : -1 };

    const [sessions, total] = await Promise.all([
      RobotSession.find(filter).select('-samples').sort(sortObj).skip(skip).limit(parseInt(limit)).lean(),
      RobotSession.countDocuments(filter)
    ]);

    res.json({
      sessions,
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    console.error('Error fetching sessions:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/sessions/:id
 * Single session with full telemetry samples and trip calculation.
 */
router.get('/sessions/:id', async (req, res) => {
  try {
    const session = await RobotSession.findOne({ sessionId: req.params.id }).lean();
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    console.error('Error fetching session:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/import
 * Trigger seed import from within the app.
 */
router.post('/import', async (req, res) => {
  try {
    const { runSeed } = require('../scripts/seed');
    await runSeed();
    await seedRobotSessions();
    res.json({ success: true, message: 'Data imported and deduplicated successfully' });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
