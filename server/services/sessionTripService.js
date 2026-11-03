const fs = require('fs');
const readline = require('readline');
const path = require('path');
const RobotSession = require('../models/RobotSession');

function cleanMongoLine(line) {
  const stripped = line.trim();
  if (!stripped) return null;
  try {
    return JSON.parse(stripped);
  } catch (e) {
    // Strip wrappers
    let text = stripped
      .replace(/NumberInt\(['"]?(-?\d+)['"]?\)/g, '$1')
      .replace(/NumberLong\(['"]?(-?\d+)['"]?\)/g, '$1')
      .replace(/Double\(['"]?(-?[\d\.]+(?:[eE][-+]?\d+)?)['"]?\)/g, '$1')
      .replace(/NumberDecimal\(['"]?(-?[\d\.]+(?:[eE][-+]?\d+)?)['"]?\)/g, '$1')
      .replace(/ISODate\(['"]([^'"]+)['"]\)/g, '"$1"')
      .replace(/ObjectId\(['"]([^'"]+)['"]\)/g, '"$1"')
      .replace(/Timestamp\(\s*(\d+)\s*,\s*\d+\s*\)/g, '$1');

    try {
      return JSON.parse(text);
    } catch (err) {
      text = text
        .replace(/([{,]\s*)'([a-zA-Z0-9_]+)'\s*:/g, '$1"$2":')
        .replace(/:\s*'([^']*)'/g, ': "$1"')
        .replace(/(?<=[\[,])\s*'([^']*)'\s*(?=[,\s\]])/g, ' "$1"');
      return JSON.parse(text);
    }
  }
}

function parseIso(ts) {
  return new Date(ts).getTime() / 1000.0;
}

function processSession(session, opts = {}) {
  const loadThresh = opts.loadThreshold || 100.0;
  const unloadThresh = opts.unloadThreshold || 50.0;
  const maxSpeed = opts.maxSpeed || 2.0;
  const motionThresh = opts.motionThreshold || 0.05;

  const pArr = session.payloadWeight || [];
  const dArr = session.distance || [];
  if (pArr.length === 0 || dArr.length === 0) return { trips: [], samples: [] };

  const table = {};
  for (const item of dArr) {
    if (item.timestamp) {
      if (!table[item.timestamp]) table[item.timestamp] = {};
      table[item.timestamp].distance = parseFloat(item.data) || 0;
    }
  }
  for (const item of pArr) {
    if (item.timestamp) {
      if (!table[item.timestamp]) table[item.timestamp] = {};
      table[item.timestamp].payload = parseFloat(item.data) || 0;
    }
  }
  for (const item of (session.battery || [])) {
    if (item.timestamp) {
      if (!table[item.timestamp]) table[item.timestamp] = {};
      table[item.timestamp].voltage = parseFloat(item.voltage) || 0;
      table[item.timestamp].current = parseFloat(item.current) || 0;
      table[item.timestamp].percentage = parseFloat(item.percentage) || 0;
    }
  }
  for (const item of (session.mmr || [])) {
    if (item.timestamp) {
      if (!table[item.timestamp]) table[item.timestamp] = {};
      table[item.timestamp].mmrVoltage = parseFloat(item.mmrVoltage) || 0;
      table[item.timestamp].mmrCurrent = parseFloat(item.mmrCurrent) || 0;
      table[item.timestamp].mmrPower = parseFloat(item.mmrPower) || 0;
    }
  }

  const sortedTs = Object.keys(table).sort();
  if (sortedTs.length < 5) return { trips: [], samples: [] };

  const samples = sortedTs.map(ts => {
    const s = table[ts];
    return {
      timestamp: ts,
      t_epoch: parseIso(ts),
      distance: s.distance,
      payload: s.payload,
      voltage: s.voltage || 0,
      current: s.current || 0,
      percentage: s.percentage || 0,
      mmrVoltage: s.mmrVoltage || 0,
      mmrCurrent: s.mmrCurrent || 0,
      mmrPower: s.mmrPower || 0
    };
  });

  let lastD = 0;
  let lastP = 0;
  for (const s of samples) {
    if (s.distance !== undefined) lastD = s.distance;
    else s.distance = lastD;
    if (s.payload !== undefined) lastP = s.payload;
    else s.payload = lastP;
  }

  const metadata = session.metadata || {};
  const sessionId = metadata.sessionId || '';
  const robotId = metadata.robotId || '';
  const sessionStart = session.timestamp || samples[0].timestamp;

  const trips = [];
  const n = samples.length;
  let i = 0;

  while (i < n) {
    while (i < n && samples[i].payload <= loadThresh) i++;
    if (i >= n) break;

    const loadIdx = i;
    const startedLoaded = (loadIdx === 0);

    let unloadIdx = null;
    for (let j = loadIdx + 1; j < n; j++) {
      if (samples[j].payload < unloadThresh) {
        unloadIdx = j;
        break;
      }
    }

    const endedLoaded = (unloadIdx === null);
    const lastLoadedIdx = unloadIdx !== null ? (unloadIdx - 1) : (n - 1);

    let firstMovingIdx = null;
    for (let k = loadIdx + 1; k <= lastLoadedIdx; k++) {
      const rawStep = samples[k].distance - samples[k - 1].distance;
      if (rawStep > motionThresh) {
        firstMovingIdx = k;
        break;
      }
    }

    if (firstMovingIdx === null) {
      i = unloadIdx !== null ? (unloadIdx + 1) : n;
      continue;
    }

    const startIdx = firstMovingIdx - 1;
    let endIdx;
    let isIncomplete;
    if (!endedLoaded) {
      endIdx = lastLoadedIdx;
      isIncomplete = false;
    } else {
      let lastMovingIdx = null;
      for (let k = lastLoadedIdx; k > startIdx; k--) {
        const rawStep = samples[k].distance - samples[k - 1].distance;
        if (rawStep > motionThresh) {
          lastMovingIdx = k;
          break;
        }
      }
      endIdx = lastMovingIdx !== null ? lastMovingIdx : startIdx;
      isIncomplete = true;
    }

    const duration_s = samples[endIdx].t_epoch - samples[startIdx].t_epoch;
    const raw_odo_delta = samples[endIdx].distance - samples[startIdx].distance;

    let cleanDistance = 0;
    let glitchesRemoved = 0;
    let stoppedTimeS = 0;

    for (let k = startIdx + 1; k <= endIdx; k++) {
      const dt = samples[k].t_epoch - samples[k - 1].t_epoch;
      const rawStep = samples[k].distance - samples[k - 1].distance;
      const speed = dt > 0 ? (rawStep / dt) : 0;

      let cleanStep = 0;
      if (speed > maxSpeed || rawStep < 0) {
        glitchesRemoved++;
        cleanStep = 0;
      } else {
        cleanStep = Math.max(0, rawStep);
      }
      cleanDistance += cleanStep;

      if (cleanStep <= motionThresh) {
        stoppedTimeS += dt;
      }
    }

    const avgSpeed = duration_s > 0 ? (cleanDistance / duration_s) : 0;
    const loadedPayloads = [];
    for (let k = startIdx; k <= endIdx; k++) {
      if (samples[k].payload > loadThresh) loadedPayloads.push(samples[k].payload);
    }
    const repPayload = loadedPayloads.length > 0
      ? (loadedPayloads.reduce((a, b) => a + b, 0) / loadedPayloads.length)
      : samples[startIdx].payload;

    const flags = [];
    if (startedLoaded) flags.push('started_loaded');
    if (endedLoaded) flags.push('ended_loaded');
    if (isIncomplete) flags.push('incomplete');
    if (glitchesRemoved > 0) flags.push('glitches_removed');

    trips.push({
      sessionId,
      robotId,
      session_start: sessionStart,
      trip_start: samples[startIdx].timestamp,
      trip_end: samples[endIdx].timestamp,
      duration_s: Math.round(duration_s * 1000) / 1000,
      distance: Math.round(cleanDistance * 1000) / 1000,
      raw_odo_delta: Math.round(raw_odo_delta * 1000) / 1000,
      avg_speed: Math.round(avgSpeed * 10000) / 10000,
      stopped_time_s: Math.round(stoppedTimeS * 1000) / 1000,
      payload: Math.round(repPayload * 100) / 100,
      glitches_removed: glitchesRemoved,
      flags: flags.join(', '),
      is_incomplete: isIncomplete
    });

    i = unloadIdx !== null ? (unloadIdx + 1) : n;
  }

  return { trips, samples };
}

async function seedRobotSessions(customFilePath) {
  const filePath = customFilePath || path.join(__dirname, '../../data/sessions.jsonl');
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  console.log(`🤖 Processing and ingesting robot sessions from ${filePath}...`);
  const fileStream = fs.createReadStream(filePath, 'utf-8');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const seenKeys = new Set();
  const docsToInsert = [];
  let lineCount = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    lineCount++;
    const session = cleanMongoLine(line);
    if (!session) continue;

    const sessionInfo = session.sessionInfo || {};
    const ts = session.timestamp;
    const opTime = sessionInfo.operationTime;
    const dist = sessionInfo.distanceTravelled;
    const dedupKey = `${ts}|${opTime}|${dist}`;

    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    const { trips, samples } = processSession(session);
    const metadata = session.metadata || {};
    const sessionId = metadata.sessionId || `session-${docsToInsert.length + 1}`;
    const robotId = metadata.robotId || '';

    const start = session.timestamp ? new Date(session.timestamp) : (samples.length ? new Date(samples[0].timestamp) : new Date());
    const end = sessionInfo.sessionEndTimestamp ? new Date(sessionInfo.sessionEndTimestamp) : (samples.length ? new Date(samples[samples.length - 1].timestamp) : start);

    docsToInsert.push({
      sessionId,
      robotId,
      name: sessionInfo.name || 'MMR-132 Session',
      start,
      end,
      distanceTravelled: parseFloat(sessionInfo.distanceTravelled) || 0,
      operationTime: parseFloat(sessionInfo.operationTime) || 0,
      energyConsumed: parseFloat(sessionInfo.energyConsumed) || 0,
      sampleCount: samples.length,
      tripsCount: trips.length,
      trips,
      samples
    });
  }

  console.log(`   Deduplicated ${lineCount} raw sessions -> ${docsToInsert.length} unique robot sessions.`);
  await RobotSession.deleteMany({});
  await RobotSession.insertMany(docsToInsert, { ordered: false });
  console.log(`   ✅ Successfully saved ${docsToInsert.length} robot sessions with calculated loaded trips to MongoDB!`);

  return {
    rawLines: lineCount,
    uniqueSessions: docsToInsert.length,
    sessionsWithTrips: docsToInsert.filter(d => d.tripsCount > 0).length
  };
}

module.exports = {
  cleanMongoLine,
  processSession,
  seedRobotSessions
};
