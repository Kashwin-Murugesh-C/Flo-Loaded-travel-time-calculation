/**
 * tripMetrics.js – Pure computation service for loaded-transit metrics.
 *
 * All functions are pure (no DB calls) so they can be unit-tested in isolation.
 * The orchestration layer (routes) feeds data in and persists results out.
 */

/**
 * Interpolate odometer value at a target timestamp between two samples.
 * Linear interpolation on the odometer reading.
 */
function interpolateOdometer(before, after, targetMs) {
  if (!before || !after) return null;
  const t0 = before.timestamp;
  const t1 = after.timestamp;
  if (t1 === t0) return before.odometer_m;
  const fraction = (targetMs - t0) / (t1 - t0);
  return before.odometer_m + fraction * (after.odometer_m - before.odometer_m);
}

/**
 * Compute loaded-transit time in seconds.
 * Returns { loadedTimeSec, valid, reason }
 */
function computeLoadedTime(loadingEndMs, unloadingStartMs) {
  if (loadingEndMs == null || unloadingStartMs == null) {
    return { loadedTimeSec: null, valid: false, reason: 'missing_timestamps' };
  }
  const diff = (unloadingStartMs - loadingEndMs) / 1000;
  if (diff < 0) {
    return { loadedTimeSec: diff, valid: false, reason: 'negative_window' };
  }
  if (diff === 0) {
    return { loadedTimeSec: 0, valid: false, reason: 'zero_window' };
  }
  return { loadedTimeSec: diff, valid: true, reason: null };
}

/**
 * Find sessions that overlap the [windowStart, windowEnd] interval.
 * Each session has { sessionId, start (ms), end (ms) }.
 * Overlap: session.start < windowEnd AND session.end > windowStart
 */
function findOverlappingSessions(sessions, windowStartMs, windowEndMs) {
  return sessions.filter(s =>
    s.start < windowEndMs && s.end > windowStartMs
  );
}

/**
 * Clip odometer samples to the window [windowStartMs, windowEndMs].
 * Samples is an array of { timestamp (ms), odometer_m }, sorted by timestamp.
 * If the window edge falls between samples, interpolate.
 * Returns only samples within the window, with interpolated edge values.
 *
 * IMPORTANT: Only processes samples from ONE session at a time.
 * The caller must group by session and call this per-session.
 */
function clipSamplesToWindow(samples, windowStartMs, windowEndMs) {
  if (!samples || samples.length === 0) return [];

  // Filter samples already inside the window
  const inside = samples.filter(
    s => s.timestamp >= windowStartMs && s.timestamp <= windowEndMs
  );

  const result = [];

  // Interpolate at window start if needed
  const firstInside = inside.length > 0 ? inside[0] : null;
  if (!firstInside || firstInside.timestamp > windowStartMs) {
    // Find the sample just before windowStart
    let before = null;
    let after = null;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].timestamp <= windowStartMs) {
        before = samples[i];
      }
      if (samples[i].timestamp >= windowStartMs && after == null) {
        after = samples[i];
      }
    }
    if (before && after && before !== after) {
      const interpVal = interpolateOdometer(
        { timestamp: before.timestamp, odometer_m: before.odometer_m },
        { timestamp: after.timestamp, odometer_m: after.odometer_m },
        windowStartMs
      );
      if (interpVal !== null) {
        result.push({ timestamp: windowStartMs, odometer_m: interpVal, interpolated: true });
      }
    } else if (before && before.timestamp === windowStartMs) {
      // Exact match
    }
    // If after but no before, first sample is after windowStart – no interpolation needed
  }

  // Add all inside samples
  for (const s of inside) {
    result.push({ timestamp: s.timestamp, odometer_m: s.odometer_m });
  }

  // Interpolate at window end if needed
  const lastInside = inside.length > 0 ? inside[inside.length - 1] : null;
  if (!lastInside || lastInside.timestamp < windowEndMs) {
    let before = null;
    let after = null;
    for (let i = 0; i < samples.length; i++) {
      if (samples[i].timestamp <= windowEndMs) {
        before = samples[i];
      }
      if (samples[i].timestamp >= windowEndMs && after == null) {
        after = samples[i];
      }
    }
    if (before && after && before !== after) {
      const interpVal = interpolateOdometer(
        { timestamp: before.timestamp, odometer_m: before.odometer_m },
        { timestamp: after.timestamp, odometer_m: after.odometer_m },
        windowEndMs
      );
      if (interpVal !== null) {
        result.push({ timestamp: windowEndMs, odometer_m: interpVal, interpolated: true });
      }
    }
  }

  // Deduplicate by timestamp (interpolated edges might coincide with existing samples)
  const seen = new Set();
  const deduped = [];
  for (const s of result) {
    if (!seen.has(s.timestamp)) {
      seen.add(s.timestamp);
      deduped.push(s);
    }
  }

  return deduped.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Compute forward-distance from an array of odometer samples (clipped to window).
 * Handles resets: if o[i+1] < o[i], treat as a reset – start a new baseline.
 * Never counts negative deltas as distance.
 *
 * Returns { distance, resetCount }
 */
function computeDistanceFromSamples(clippedSamples) {
  if (!clippedSamples || clippedSamples.length < 2) {
    return { distance: 0, resetCount: 0 };
  }

  let distance = 0;
  let resetCount = 0;

  for (let i = 1; i < clippedSamples.length; i++) {
    const delta = clippedSamples[i].odometer_m - clippedSamples[i - 1].odometer_m;
    if (delta < 0) {
      // Reset detected – start new baseline, don't add distance
      resetCount++;
    } else {
      distance += delta;
    }
  }

  return { distance, resetCount };
}

/**
 * Compute coverage: what fraction of the window is covered by odometer samples.
 * samplesPerSession: array of { sessionStart, sessionEnd, samples[] } already clipped.
 * Returns coverage ratio 0..1.
 */
function computeCoverage(samplesPerSession, windowStartMs, windowEndMs) {
  const windowDuration = windowEndMs - windowStartMs;
  if (windowDuration <= 0) return 0;

  let coveredMs = 0;
  for (const { samples } of samplesPerSession) {
    if (samples.length < 2) continue;
    const first = samples[0].timestamp;
    const last = samples[samples.length - 1].timestamp;
    coveredMs += (last - first);
  }

  return Math.min(1, coveredMs / windowDuration);
}

/**
 * Compute estimated distance from session summaries (fallback).
 * For each overlapping session, estimate proportional distance:
 *   distanceTravelled * overlapSec / sessionDurationSec
 */
function computeEstimatedDistance(overlappingSessions, windowStartMs, windowEndMs) {
  let total = 0;
  for (const session of overlappingSessions) {
    const sessionDuration = session.end - session.start;
    if (sessionDuration <= 0) continue;

    const overlapStart = Math.max(session.start, windowStartMs);
    const overlapEnd = Math.min(session.end, windowEndMs);
    const overlapMs = Math.max(0, overlapEnd - overlapStart);

    total += (session.distanceTravelled || 0) * (overlapMs / sessionDuration);
  }
  return total;
}

/**
 * Main computation: compute all metrics for a single trip.
 *
 * @param {Object} trip – { loadingEnd (ms), unloadingStart (ms), tripId, operatorName, typeOfMaterial }
 * @param {Array} sessions – [{ sessionId, start (ms), end (ms), distanceTravelled }]
 * @param {Object} samplesBySession – { sessionId: [{ timestamp (ms), odometer_m }] } sorted by timestamp
 * @returns {Object} metric result
 */
function computeTripMetrics(trip, sessions, samplesBySession) {
  const { loadedTimeSec, valid, reason } = computeLoadedTime(
    trip.loadingEnd, trip.unloadingStart
  );

  if (!valid) {
    return {
      tripId: trip.tripId,
      loadingEnd: trip.loadingEnd,
      unloadingStart: trip.unloadingStart,
      operatorName: trip.operatorName,
      typeOfMaterial: trip.typeOfMaterial,
      loadedTimeSec: loadedTimeSec,
      measuredDistance: null,
      estimatedDistance: null,
      coverage: 0,
      status: 'invalid_window',
      avgSpeedMps: null,
      sessionIds: [],
      sampleCount: 0,
      reason
    };
  }

  const windowStart = trip.loadingEnd;
  const windowEnd = trip.unloadingStart;

  // Find overlapping sessions
  const overlapping = findOverlappingSessions(sessions, windowStart, windowEnd);

  // Estimated distance from summaries (always compute as fallback)
  const estimatedDistance = computeEstimatedDistance(overlapping, windowStart, windowEnd);

  if (overlapping.length === 0) {
    return {
      tripId: trip.tripId,
      loadingEnd: trip.loadingEnd,
      unloadingStart: trip.unloadingStart,
      operatorName: trip.operatorName,
      typeOfMaterial: trip.typeOfMaterial,
      loadedTimeSec,
      measuredDistance: null,
      estimatedDistance,
      coverage: 0,
      status: 'no_data',
      avgSpeedMps: null,
      sessionIds: [],
      sampleCount: 0
    };
  }

  // Process each session's samples
  const sessionSampleData = [];
  let totalDistance = 0;
  let totalSamples = 0;
  let totalResets = 0;
  const sessionIds = [];

  for (const session of overlapping) {
    const rawSamples = samplesBySession[session.sessionId] || [];
    if (rawSamples.length === 0) continue;

    sessionIds.push(session.sessionId);

    const clipped = clipSamplesToWindow(rawSamples, windowStart, windowEnd);
    const { distance, resetCount } = computeDistanceFromSamples(clipped);

    totalDistance += distance;
    totalSamples += clipped.length;
    totalResets += resetCount;

    sessionSampleData.push({
      sessionStart: Math.max(session.start, windowStart),
      sessionEnd: Math.min(session.end, windowEnd),
      samples: clipped
    });
  }

  const coverage = computeCoverage(sessionSampleData, windowStart, windowEnd);

  let status;
  if (totalSamples < 2) {
    status = 'no_data';
  } else if (coverage >= 0.95) {
    status = 'measured';
  } else {
    status = 'partial';
  }

  const avgSpeedMps = (status === 'measured' && loadedTimeSec > 0)
    ? totalDistance / loadedTimeSec
    : null;

  return {
    tripId: trip.tripId,
    loadingEnd: trip.loadingEnd,
    unloadingStart: trip.unloadingStart,
    operatorName: trip.operatorName,
    typeOfMaterial: trip.typeOfMaterial,
    loadedTimeSec,
    measuredDistance: totalSamples >= 2 ? totalDistance : null,
    estimatedDistance,
    coverage,
    status,
    avgSpeedMps,
    sessionIds,
    sampleCount: totalSamples
  };
}

module.exports = {
  interpolateOdometer,
  computeLoadedTime,
  findOverlappingSessions,
  clipSamplesToWindow,
  computeDistanceFromSamples,
  computeCoverage,
  computeEstimatedDistance,
  computeTripMetrics
};
