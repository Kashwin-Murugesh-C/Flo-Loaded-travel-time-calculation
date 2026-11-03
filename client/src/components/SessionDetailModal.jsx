import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  X,
  Bot,
  Calendar,
  Clock,
  Gauge,
  Weight,
  AlertTriangle,
  Zap,
  Activity,
  CheckCircle,
  AlertCircle,
  ListFilter,
  Search,
  Sparkles
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend
} from 'recharts';

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatIsoTime(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toTimeString().split(' ')[0];
}

/**
 * Computes exact physical action of the robot for each sample row.
 */
function getRobotAction(samples, i, trip) {
  const s = samples[i];
  const prev = i > 0 ? samples[i - 1] : s;
  const dt = i > 0 ? (s.t_epoch - prev.t_epoch) : 1;
  const rawStep = s.distance - prev.distance;
  const speed = dt > 0 ? (rawStep / dt) : 0;
  const isGlitch = speed > 2.0 || rawStep < 0;
  const isDriveOn = s.mmrVoltage > 20.0;
  const isLoaded = s.payload > 100.0;

  // Key Event: Load Detected (Material placed on robot)
  if (i > 0 && prev.payload <= 50 && s.payload > 100) {
    return {
      type: 'load',
      text: `★ LOAD DETECTED: Material placed on robot! Weight increased from ${prev.payload.toFixed(1)} kg to ${s.payload.toFixed(1)} kg`,
      badgeClass: 'badge-measured',
      highlightColor: 'rgba(6, 182, 212, 0.2)'
    };
  }

  // Key Event 1: Trip Start
  if (trip && s.timestamp === trip.trip_start) {
    return {
      type: 'trip_start',
      text: '★ TRIP START: Last moment of rest before motion!',
      badgeClass: 'badge-measured',
      highlightColor: 'rgba(16, 185, 129, 0.15)'
    };
  }

  // Key Event 2: Trip End
  if (trip && s.timestamp === trip.trip_end) {
    return {
      type: 'trip_end',
      text: '★ TRIP END: Last loaded sample before dumping!',
      badgeClass: 'badge-partial',
      highlightColor: 'rgba(239, 68, 68, 0.15)'
    };
  }

  // Key Event 3: Unload Event
  if (i > 0 && prev.payload >= 50 && s.payload < 50) {
    return {
      type: 'unload',
      text: `★ UNLOAD DETECTED: Material dumped! Weight collapsed from ${prev.payload.toFixed(1)} kg to ${s.payload.toFixed(1)} kg`,
      badgeClass: 'badge-estimate',
      highlightColor: 'rgba(139, 92, 246, 0.2)'
    };
  }

  // Key Event 4: Glitch
  if (isGlitch) {
    return {
      type: 'glitch',
      text: `⚠️ Glitch filtered: ${rawStep.toFixed(1)} m jump in ${dt}s (${speed.toFixed(1)} m/s)`,
      badgeClass: 'badge-estimate',
      highlightColor: 'rgba(245, 158, 11, 0.15)'
    };
  }

  // Standard states
  if (isLoaded) {
    if (rawStep > 0.05) {
      if (i > 0 && prev.distance === s.distance) {
        return {
          type: 'moving_start',
          text: 'Motors power up! Wheels start rolling!',
          badgeClass: 'badge-measured',
          highlightColor: null
        };
      }
      return {
        type: 'transit',
        text: `Rolling in transit (${speed.toFixed(2)} m/s, motors energized)`,
        badgeClass: 'badge-measured',
        highlightColor: null
      };
    } else {
      return {
        type: 'loaded_stationary',
        text: `Loaded with ${s.payload.toFixed(0)} kg, but wheels stationary (Δodo = 0)`,
        badgeClass: 'badge-no_data',
        highlightColor: null
      };
    }
  } else {
    // Unloaded
    if (rawStep > 0.05) {
      return {
        type: 'empty_moving',
        text: `Empty robot rolling (${speed.toFixed(2)} m/s)`,
        badgeClass: 'badge-no_data',
        highlightColor: null
      };
    } else {
      return {
        type: 'empty_stationary',
        text: `Empty robot stationary (tare weight: ${s.payload.toFixed(1)} kg, standby)`,
        badgeClass: 'badge-no_data',
        highlightColor: null
      };
    }
  }
}

export default function SessionDetailModal({ sessionId, onClose }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionFilter, setActionFilter] = useState('all'); // 'all' | 'trip_only' | 'key_events'
  const [timelineSearch, setTimelineSearch] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    axios.get(`/api/sessions/${sessionId}`)
      .then(res => {
        setSession(res.data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load session details:', err);
        setError(err.message || 'Failed to load session data');
        setLoading(false);
      });
  }, [sessionId]);

  const primaryTrip = session && session.trips && session.trips.length > 0 ? session.trips[0] : null;

  // Prepare chart data from samples
  const chartData = useMemo(() => {
    if (!session || !session.samples) return [];
    return session.samples.map((s, idx) => {
      const elapsed = idx > 0 ? (s.t_epoch - session.samples[0].t_epoch) : 0;
      return {
        time: s.timestamp ? s.timestamp.substring(11, 19) : `${elapsed}s`,
        elapsed,
        payload: s.payload,
        distance: s.distance,
        current: s.current,
        voltage: s.voltage,
        mmrPower: s.mmrPower,
        mmrVoltage: s.mmrVoltage
      };
    });
  }, [session]);

  // Compute operational action rows
  const operationalRows = useMemo(() => {
    if (!session || !session.samples) return [];
    return session.samples.map((s, idx) => {
      const action = getRobotAction(session.samples, idx, primaryTrip);
      const isInsideTrip = primaryTrip && s.timestamp >= primaryTrip.trip_start && s.timestamp <= primaryTrip.trip_end;
      return {
        index: idx + 1,
        utcTime: s.timestamp ? s.timestamp.substring(11, 19) : '--',
        fullTimestamp: s.timestamp,
        payloadWeight: `${s.payload.toFixed(1)} kg`,
        wheelOdometer: `${s.distance.toFixed(2)} m`,
        motorVoltage: `${s.mmrVoltage.toFixed(1)} V (${s.mmrVoltage > 20 ? 'Drive ON' : 'Idle'})`,
        action,
        isInsideTrip,
        isKeyEvent: ['load', 'trip_start', 'trip_end', 'unload', 'glitch'].includes(action.type)
      };
    });
  }, [session, primaryTrip]);

  // Filtered operational rows
  const filteredRows = useMemo(() => {
    return operationalRows.filter(row => {
      if (actionFilter === 'trip_only' && !row.isInsideTrip) return false;
      if (actionFilter === 'key_events' && !row.isKeyEvent) return false;
      if (timelineSearch) {
        const query = timelineSearch.toLowerCase();
        const matchesTime = row.utcTime.toLowerCase().includes(query);
        const matchesAction = row.action.text.toLowerCase().includes(query);
        const matchesPayload = row.payloadWeight.toLowerCase().includes(query);
        if (!matchesTime && !matchesAction && !matchesPayload) return false;
      }
      return true;
    });
  }, [operationalRows, actionFilter, timelineSearch]);

  if (!sessionId) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '1200px', width: '95%' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="brand-icon" style={{ width: '38px', height: '38px' }}>
              <Bot size={20} color="#fff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Robot Session {sessionId}
                </h2>
                {primaryTrip ? (
                  <span className="badge badge-measured" style={{ fontSize: '0.75rem' }}>
                    {session?.tripsCount} Loaded Trip{session?.tripsCount > 1 ? 's' : ''} Detected
                  </span>
                ) : (
                  <span className="badge badge-no_data" style={{ fontSize: '0.75rem' }}>
                    No Loaded Trip
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.825rem', color: 'var(--text-muted)' }}>
                Robot ID: {session?.robotId || 'Unknown'} &bull; Name: {session?.name || 'MMR-132'} &bull; Date: {session?.start ? new Date(session.start).toLocaleString() : '--'}
              </div>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ maxHeight: 'calc(88vh - 110px)', overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
              Loading high-resolution session telemetry...
            </div>
          )}

          {error && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--accent-rose)' }}>
              Error: {error}
            </div>
          )}

          {session && !loading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Stat Cards Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem'
              }}>
                <div className="stat-card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    <Clock size={15} />
                    Operation Time
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>
                    {session.operationTime ? `${(session.operationTime / 1000).toFixed(1)}s` : '--'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Sample count: {session.sampleCount}
                  </div>
                </div>

                <div className="stat-card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    <Gauge size={15} />
                    Gross Session Odometer
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--accent-cyan)' }}>
                    {session.distanceTravelled != null ? `${session.distanceTravelled.toFixed(1)} m` : '--'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Total uncleaned reading
                  </div>
                </div>

                <div className="stat-card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    <Weight size={15} />
                    Loaded Trip Clean Distance
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--accent-emerald)' }}>
                    {primaryTrip ? `${primaryTrip.distance.toFixed(2)} m` : '0.00 m'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Raw delta: {primaryTrip ? `${primaryTrip.raw_odo_delta.toFixed(2)} m` : '0.00 m'}
                  </div>
                </div>

                <div className="stat-card" style={{ padding: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    <AlertTriangle size={15} />
                    Glitches Removed
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--accent-amber)' }}>
                    {primaryTrip ? primaryTrip.glitches_removed : 0}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    Speed jumps &gt; 2.0 m/s &amp; resets
                  </div>
                </div>
              </div>

              {/* SECTION 1: Synchronized Telemetry Charts */}
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Activity size={16} color="var(--accent-cyan)" />
                    Synchronized Telemetry Charts (Payload &bull; Odometer &bull; Electrical)
                  </h3>
                  {primaryTrip && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                      Trip Window: <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{formatIsoTime(primaryTrip.trip_start)} &rarr; {formatIsoTime(primaryTrip.trip_end)}</span> ({primaryTrip.duration_s}s)
                    </div>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
                  {/* Panel 1: Payload */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      Payload Weight (kg) &bull; Thresholds: 100 kg (Load) / 50 kg (Unload)
                    </div>
                    <div style={{ width: '100%', height: 160 }}>
                      <ResponsiveContainer>
                        <LineChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} />
                          <YAxis stroke="var(--text-muted)" fontSize={10} />
                          <Tooltip contentStyle={{ background: '#101622', borderColor: 'var(--border-subtle)', borderRadius: '6px', fontSize: '11px' }} />
                          <ReferenceLine y={100} stroke="#10b981" strokeDasharray="3 3" />
                          <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="3 3" />
                          <Line type="monotone" dataKey="payload" stroke="#06b6d4" strokeWidth={2} dot={false} name="Payload (kg)" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Panel 2: Odometer */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      Odometer Trajectory (m) &bull; Wheel Encoders
                    </div>
                    <div style={{ width: '100%', height: 160 }}>
                      <ResponsiveContainer>
                        <LineChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} />
                          <YAxis stroke="var(--text-muted)" fontSize={10} domain={['auto', 'auto']} />
                          <Tooltip contentStyle={{ background: '#101622', borderColor: 'var(--border-subtle)', borderRadius: '6px', fontSize: '11px' }} />
                          <Line type="monotone" dataKey="distance" stroke="#10b981" strokeWidth={2} dot={false} name="Odometer (m)" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Panel 3: Motor Voltage & Current */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.75rem' }}>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      Motor Voltage (V) &amp; Battery Current (A)
                    </div>
                    <div style={{ width: '100%', height: 160 }}>
                      <ResponsiveContainer>
                        <LineChart data={chartData} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                          <XAxis dataKey="time" stroke="var(--text-muted)" fontSize={10} />
                          <YAxis stroke="var(--text-muted)" fontSize={10} />
                          <Tooltip contentStyle={{ background: '#101622', borderColor: 'var(--border-subtle)', borderRadius: '6px', fontSize: '11px' }} />
                          <Line type="monotone" dataKey="mmrVoltage" stroke="#8b5cf6" strokeWidth={1.5} dot={false} name="Motor Voltage (V)" />
                          <Line type="monotone" dataKey="current" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Current (A)" />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 2: Exact Second-by-Second Robot Action & Operational Log */}
              <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Sparkles size={17} color="var(--accent-amber)" />
                      Second-by-Second Robot Operational Action Log
                    </h3>
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                      Visual audit of payload load cells, wheel odometer, motor voltage, and automated state detection at each second.
                    </p>
                  </div>

                  {/* Filter controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', background: 'var(--bg-input)', borderRadius: '6px', padding: '0.2rem', border: '1px solid var(--border-subtle)' }}>
                      <button
                        className={`nav-btn ${actionFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setActionFilter('all')}
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                      >
                        All Seconds ({operationalRows.length})
                      </button>
                      <button
                        className={`nav-btn ${actionFilter === 'trip_only' ? 'active' : ''}`}
                        onClick={() => setActionFilter('trip_only')}
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                      >
                        Trip Window Only ({operationalRows.filter(r => r.isInsideTrip).length})
                      </button>
                      <button
                        className={`nav-btn ${actionFilter === 'key_events' ? 'active' : ''}`}
                        onClick={() => setActionFilter('key_events')}
                        style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem' }}
                      >
                        Key Events Only ({operationalRows.filter(r => r.isKeyEvent).length})
                      </button>
                    </div>

                    <div className="search-input-wrapper" style={{ width: '160px' }}>
                      <Search size={14} className="search-icon" />
                      <input
                        type="text"
                        className="search-input"
                        placeholder="Search time/state..."
                        value={timelineSearch}
                        onChange={(e) => setTimelineSearch(e.target.value)}
                        style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem 0.3rem 1.8rem' }}
                      />
                    </div>
                  </div>
                </div>

                {/* The EXACT 5-Column Operational Table */}
                <div className="table-container" style={{ border: '1px solid var(--border-subtle)', borderRadius: '8px', maxHeight: '420px', overflowY: 'auto' }}>
                  <table className="telemetry-table" style={{ fontSize: '0.825rem' }}>
                    <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: '#101622' }}>
                      <tr>
                        <th style={{ width: '100px' }}>UTC Time</th>
                        <th style={{ width: '160px' }}>Payload Weight (Load Cells)</th>
                        <th style={{ width: '140px' }}>Wheel Odometer</th>
                        <th style={{ width: '170px' }}>Motor Voltage</th>
                        <th>What the Robot is Doing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row) => (
                        <tr
                          key={row.index}
                          style={{
                            background: row.action.highlightColor || (row.isInsideTrip ? 'rgba(56, 189, 248, 0.03)' : 'transparent'),
                            borderLeft: row.action.type === 'load'
                              ? '4px solid #06b6d4'
                              : row.action.type === 'trip_start'
                              ? '4px solid #10b981'
                              : row.action.type === 'trip_end'
                              ? '4px solid #ef4444'
                              : row.action.type === 'unload'
                              ? '4px solid #8b5cf6'
                              : row.action.type === 'glitch'
                              ? '4px solid #f59e0b'
                              : 'none'
                          }}
                        >
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: row.isInsideTrip ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
                            {row.utcTime}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', fontWeight: parseFloat(row.payloadWeight) > 100 ? 700 : 400, color: parseFloat(row.payloadWeight) > 100 ? 'var(--accent-cyan)' : 'inherit' }}>
                            {row.payloadWeight}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>
                            {row.wheelOdometer}
                          </td>
                          <td style={{ fontFamily: 'var(--font-mono)', color: row.motorVoltage.includes('Drive ON') ? 'var(--accent-purple)' : 'var(--text-muted)' }}>
                            {row.motorVoltage}
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span
                                className={`badge ${row.action.badgeClass}`}
                                style={{
                                  fontSize: '0.72rem',
                                  padding: '0.2rem 0.5rem',
                                  fontWeight: row.isKeyEvent ? 700 : 500
                                }}
                              >
                                {row.action.text}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <div>
                    Showing {filteredRows.length} of {operationalRows.length} seconds
                  </div>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <span>🔵 Cyan: Load Detected</span>
                    <span>🟢 Green: Trip Start</span>
                    <span>🔴 Red: Trip End</span>
                    <span>🟣 Violet: Unload Detected</span>
                    <span>🟡 Amber: Glitch Filtered</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
