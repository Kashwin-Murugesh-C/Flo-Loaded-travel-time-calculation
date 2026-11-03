const {
  interpolateOdometer,
  computeLoadedTime,
  findOverlappingSessions,
  clipSamplesToWindow,
  computeDistanceFromSamples,
  computeCoverage,
  computeEstimatedDistance,
  computeTripMetrics
} = require('../services/tripMetrics');

// Helpers
const ts = (iso) => new Date(iso).getTime();
const mkSample = (isoOrMs, odo) => ({
  timestamp: typeof isoOrMs === 'number' ? isoOrMs : ts(isoOrMs),
  odometer_m: odo
});

// ────────────────────────────────────────────────────────────────
// 1. NEGATIVE WINDOW
// ────────────────────────────────────────────────────────────────
describe('Negative window', () => {
  test('loadingEnd after unloadingStart returns invalid_window', () => {
    const trip = {
      tripId: 'T1',
      loadingEnd: ts('2026-09-15T06:00:00Z'),
      unloadingStart: ts('2026-09-15T05:50:00Z'),
      operatorName: 'A',
      typeOfMaterial: 'Dust'
    };
    const result = computeTripMetrics(trip, [], {});
    expect(result.status).toBe('invalid_window');
    expect(result.loadedTimeSec).toBeLessThan(0);
    expect(result.reason).toBe('negative_window');
  });

  test('missing timestamps returns invalid_window', () => {
    const trip = {
      tripId: 'T2',
      loadingEnd: null,
      unloadingStart: ts('2026-09-15T06:00:00Z'),
      operatorName: 'A',
      typeOfMaterial: 'Dust'
    };
    const result = computeTripMetrics(trip, [], {});
    expect(result.status).toBe('invalid_window');
    expect(result.reason).toBe('missing_timestamps');
  });
});

// ────────────────────────────────────────────────────────────────
// 2. RESET MID-WINDOW
// ────────────────────────────────────────────────────────────────
describe('Reset mid-window', () => {
  test('odometer reset mid-window only counts forward deltas', () => {
    const samples = [
      mkSample(1000, 100),
      mkSample(2000, 110),
      mkSample(3000, 120),
      mkSample(4000, 5),     // RESET
      mkSample(5000, 15),
      mkSample(6000, 25),
    ];
    const { distance, resetCount } = computeDistanceFromSamples(samples);
    // Forward: (110-100) + (120-110) + (15-5) + (25-15) = 10 + 10 + 10 + 10 = 40
    // Reset at step 3->4 (120->5)
    expect(distance).toBe(40);
    expect(resetCount).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────
// 3. DUPLICATE SESSIONS
// ────────────────────────────────────────────────────────────────
describe('Duplicate sessions', () => {
  test('overlapping sessions with identical time range found once each', () => {
    const sessions = [
      { sessionId: 'S1', start: 1000, end: 5000, distanceTravelled: 50 },
      { sessionId: 'S1-dup', start: 1000, end: 5000, distanceTravelled: 50 },
      { sessionId: 'S2', start: 6000, end: 9000, distanceTravelled: 30 },
    ];
    const overlapping = findOverlappingSessions(sessions, 2000, 8000);
    expect(overlapping).toHaveLength(3); // dedup is at import, not query
    expect(overlapping.map(s => s.sessionId).sort()).toEqual(['S1', 'S1-dup', 'S2']);
  });
});

// ────────────────────────────────────────────────────────────────
// 4. WINDOW SPANNING TWO SESSIONS WITH A GAP
// ────────────────────────────────────────────────────────────────
describe('Window spanning two sessions with gap', () => {
  test('distance computed per-session, gap does not accumulate', () => {
    // Session A: 0-10s, odo 100->120  (20m)
    // Gap: 10-15s (no data)
    // Session B: 15-25s, odo 200->230 (30m)
    // Window: 0-25s

    const sessionA = { sessionId: 'A', start: 0, end: 10000, distanceTravelled: 20 };
    const sessionB = { sessionId: 'B', start: 15000, end: 25000, distanceTravelled: 30 };
    const sessions = [sessionA, sessionB];

    const samplesA = [
      mkSample(0, 100), mkSample(2000, 104), mkSample(4000, 108),
      mkSample(6000, 112), mkSample(8000, 116), mkSample(10000, 120)
    ];
    const samplesB = [
      mkSample(15000, 200), mkSample(17000, 206), mkSample(19000, 212),
      mkSample(21000, 218), mkSample(23000, 224), mkSample(25000, 230)
    ];

    const samplesBySession = { A: samplesA, B: samplesB };
    const trip = {
      tripId: 'T-gap',
      loadingEnd: 0,
      unloadingStart: 25000,
      operatorName: 'X',
      typeOfMaterial: 'Motor'
    };

    const result = computeTripMetrics(trip, sessions, samplesBySession);

    // Session A: 120-100=20, Session B: 230-200=30, total=50
    expect(result.measuredDistance).toBe(50);
    // Coverage: (10000-0) + (25000-15000) = 10+10=20 of 25s => 0.8
    expect(result.coverage).toBeCloseTo(0.8, 2);
    expect(result.status).toBe('partial');
    expect(result.avgSpeedMps).toBeNull(); // not measured (coverage < 0.95)
  });
});

// ────────────────────────────────────────────────────────────────
// 5. ZERO OVERLAP
// ────────────────────────────────────────────────────────────────
describe('Zero overlap', () => {
  test('no sessions overlap the window => no_data', () => {
    const sessions = [
      { sessionId: 'S1', start: 0, end: 5000, distanceTravelled: 100 }
    ];
    const trip = {
      tripId: 'T-none',
      loadingEnd: 10000,
      unloadingStart: 20000,
      operatorName: 'Y',
      typeOfMaterial: 'Dust'
    };
    const result = computeTripMetrics(trip, sessions, {});
    expect(result.status).toBe('no_data');
    expect(result.measuredDistance).toBeNull();
    expect(result.sessionIds).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────
// 6. FULL OVERLAP (coverage >= 0.95)
// ────────────────────────────────────────────────────────────────
describe('Full overlap', () => {
  test('session fully covers the window => measured with speed', () => {
    // Window 0s-100s, session 0-100s, samples every 1s
    const session = { sessionId: 'S-full', start: 0, end: 100000, distanceTravelled: 200 };
    const samples = [];
    for (let t = 0; t <= 100000; t += 1000) {
      samples.push(mkSample(t, t / 1000 * 2)); // 2 m/s
    }

    const trip = {
      tripId: 'T-full',
      loadingEnd: 0,
      unloadingStart: 100000,
      operatorName: 'Z',
      typeOfMaterial: 'Store Material'
    };
    const result = computeTripMetrics(trip, [session], { 'S-full': samples });

    expect(result.status).toBe('measured');
    expect(result.measuredDistance).toBeCloseTo(200, 1);
    expect(result.coverage).toBeCloseTo(1.0, 2);
    expect(result.avgSpeedMps).toBeCloseTo(2.0, 2);
    expect(result.loadedTimeSec).toBe(100);
  });
});

// ────────────────────────────────────────────────────────────────
// 7. BOUNDARY INTERPOLATION
// ────────────────────────────────────────────────────────────────
describe('Boundary interpolation', () => {
  test('interpolateOdometer computes linear value', () => {
    const before = { timestamp: 0, odometer_m: 100 };
    const after = { timestamp: 10000, odometer_m: 200 };
    // At t=5000 => 150
    expect(interpolateOdometer(before, after, 5000)).toBe(150);
    // At t=2500 => 125
    expect(interpolateOdometer(before, after, 2500)).toBe(125);
  });

  test('clipSamplesToWindow interpolates at window edges', () => {
    const samples = [
      mkSample(0, 100),
      mkSample(10000, 200),
      mkSample(20000, 300),
      mkSample(30000, 400),
    ];
    // Window: 5000 to 25000
    const clipped = clipSamplesToWindow(samples, 5000, 25000);

    // Should have: interp at 5000 (150), 10000 (200), 20000 (300), interp at 25000 (350)
    expect(clipped).toHaveLength(4);
    expect(clipped[0].timestamp).toBe(5000);
    expect(clipped[0].odometer_m).toBe(150);
    expect(clipped[0].interpolated).toBe(true);
    expect(clipped[clipped.length - 1].timestamp).toBe(25000);
    expect(clipped[clipped.length - 1].odometer_m).toBe(350);
    expect(clipped[clipped.length - 1].interpolated).toBe(true);
  });

  test('window fully inside one inter-sample gap', () => {
    const samples = [
      mkSample(0, 0),
      mkSample(100000, 1000),
    ];
    // Window 20000-80000
    const clipped = clipSamplesToWindow(samples, 20000, 80000);
    expect(clipped).toHaveLength(2);
    expect(clipped[0].odometer_m).toBeCloseTo(200, 0);
    expect(clipped[1].odometer_m).toBeCloseTo(800, 0);
    const { distance } = computeDistanceFromSamples(clipped);
    expect(distance).toBeCloseTo(600, 0);
  });
});

// ────────────────────────────────────────────────────────────────
// 8. ESTIMATED DISTANCE (SUMMARY FALLBACK)
// ────────────────────────────────────────────────────────────────
describe('Estimated distance', () => {
  test('proportional calculation from session summaries', () => {
    // Session: 0-100s, 200m travelled. Window: 25s-75s (50% overlap)
    const sessions = [
      { sessionId: 'S1', start: 0, end: 100000, distanceTravelled: 200 }
    ];
    const est = computeEstimatedDistance(sessions, 25000, 75000);
    expect(est).toBeCloseTo(100, 1); // 200 * 50/100 = 100
  });

  test('multiple sessions proportional', () => {
    const sessions = [
      { sessionId: 'S1', start: 0, end: 10000, distanceTravelled: 100 },  // 100% overlap with window 0-20000
      { sessionId: 'S2', start: 15000, end: 25000, distanceTravelled: 50 }, // 50% overlap (15000-20000)/10000
    ];
    const est = computeEstimatedDistance(sessions, 0, 20000);
    // S1: 100 * 10000/10000 = 100
    // S2: 50 * 5000/10000 = 25
    expect(est).toBeCloseTo(125, 1);
  });
});

// ────────────────────────────────────────────────────────────────
// 9. COVERAGE CALCULATION
// ────────────────────────────────────────────────────────────────
describe('Coverage', () => {
  test('computes coverage from sample spans per session', () => {
    const data = [
      { samples: [mkSample(0, 0), mkSample(5000, 10)] },
      { samples: [mkSample(8000, 20), mkSample(10000, 30)] },
    ];
    // Covered: 5000 + 2000 = 7000 of 10000 window
    const cov = computeCoverage(data, 0, 10000);
    expect(cov).toBeCloseTo(0.7, 2);
  });

  test('single sample => no coverage', () => {
    const data = [{ samples: [mkSample(5000, 10)] }];
    expect(computeCoverage(data, 0, 10000)).toBe(0);
  });
});
