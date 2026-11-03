import React, { useEffect, useState } from 'react';
import axios from 'axios';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine
} from 'recharts';
import { X, Clock, Navigation, Gauge, ShieldAlert, Cpu, Calendar, CheckCircle2 } from 'lucide-react';
import StatusBadge from './StatusBadge';

// Format seconds into mm:ss
function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '--:--';
  const mins = Math.floor(Math.abs(seconds) / 60);
  const secs = Math.floor(Math.abs(seconds) % 60);
  return `${seconds < 0 ? '-' : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Format ISO date
function formatIso(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + 
    ' (' + d.toLocaleDateString() + ')';
}

export default function TripDetailModal({ tripId, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('chart'); // 'chart' | 'samples'

  useEffect(() => {
    let isMounted = true;
    axios.get(`/api/trips/${tripId}`)
      .then(res => {
        if (isMounted) {
          setData(res.data);
          setLoading(false);
        }
      })
      .catch(err => {
        console.error('Failed to load trip detail:', err);
        if (isMounted) setLoading(false);
      });
    return () => { isMounted = false; };
  }, [tripId]);

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()} style={{ textAlign: 'center', padding: '3rem' }}>
          <div style={{ color: 'var(--accent-cyan)' }}>Loading telemetry audit for Trip #{tripId}...</div>
        </div>
      </div>
    );
  }

  if (!data || !data.trip) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <div style={{ color: 'var(--accent-rose)' }}>Trip telemetry not found.</div>
          <button className="btn-secondary" onClick={onClose} style={{ marginTop: '1rem' }}>Close</button>
        </div>
      </div>
    );
  }

  const { trip, metric, odometerSamples } = data;

  // Prepare chart data
  const loadingEndMs = trip.loadingEnd ? new Date(trip.loadingEnd).getTime() : null;
  const unloadingStartMs = trip.unloadingStart ? new Date(trip.unloadingStart).getTime() : null;

  // Map odometer samples to chart points
  const chartPoints = (odometerSamples || []).map(s => {
    const t = new Date(s.timestamp).getTime();
    return {
      timestamp: t,
      timeLabel: new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      odometer: s.odometer_m,
      isLoadedInterval: loadingEndMs && unloadingStartMs && t >= loadingEndMs && t <= unloadingStartMs
    };
  });

  // Calculate chart domain
  const timeLabels = chartPoints.map(p => p.timeLabel);
  const startLabel = loadingEndMs ? new Date(loadingEndMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
  const endLabel = unloadingStartMs ? new Date(unloadingStartMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>Trip #{trip.tripId}</h2>
              <StatusBadge status={metric?.status} coverage={metric?.coverage} />
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Operator: <span style={{ color: 'var(--text-primary)' }}>{trip.operatorName || 'Unknown'}</span> • 
              Material: <span style={{ color: 'var(--accent-cyan)' }}>{trip.typeOfMaterial || 'Unspecified'}</span> •
              Quantity: <span style={{ color: 'var(--text-primary)' }}>{trip.quantity}</span>
            </div>
          </div>
          <button className="close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* Top Metric Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <div className="metric-stat-box">
            <div className="stat-label">Loaded Window (mm:ss)</div>
            <div className="stat-val" style={{ color: 'var(--accent-cyan)' }}>
              {formatTime(metric?.loadedTimeSec)}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {metric?.loadedTimeSec != null ? `${metric.loadedTimeSec.toFixed(1)}s` : 'N/A'}
            </div>
          </div>

          <div className="metric-stat-box">
            <div className="stat-label">Measured Distance</div>
            <div className="stat-val" style={{ color: metric?.status === 'measured' ? 'var(--accent-emerald)' : metric?.status === 'partial' ? 'var(--accent-amber)' : 'var(--text-muted)' }}>
              {metric?.measuredDistance != null ? `${metric.measuredDistance.toFixed(1)} m` : '--'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {metric?.status === 'measured' ? 'High-confidence (odometer)' : metric?.status === 'partial' ? 'Partial window samples' : 'No odometer overlap'}
            </div>
          </div>

          <div className="metric-stat-box">
            <div className="stat-label">Telemetry Coverage</div>
            <div className="stat-val" style={{ color: (metric?.coverage || 0) >= 0.95 ? 'var(--accent-emerald)' : 'var(--accent-amber)' }}>
              {metric?.coverage != null ? `${(metric.coverage * 100).toFixed(1)}%` : '0%'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Threshold: ≥ 95% measured
            </div>
          </div>

          <div className="metric-stat-box">
            <div className="stat-label">Avg Speed</div>
            <div className="stat-val" style={{ color: metric?.avgSpeedMps != null ? '#fff' : 'var(--text-muted)' }}>
              {metric?.avgSpeedMps != null ? `${metric.avgSpeedMps.toFixed(2)} m/s` : 'N/A'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {metric?.status === 'measured' ? `${(metric.avgSpeedMps * 3.6).toFixed(1)} km/h` : 'Requires status = measured'}
            </div>
          </div>

          <div className="metric-stat-box">
            <div className="stat-label">Summary Fallback (Estimate)</div>
            <div className="stat-val" style={{ color: 'var(--accent-purple)' }}>
              {metric?.estimatedDistance != null ? `${metric.estimatedDistance.toFixed(1)} m` : '0.0 m'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Always labeled estimate
            </div>
          </div>
        </div>

        {/* Tab Controls */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
          <button 
            className={`btn-secondary ${activeTab === 'chart' ? 'active' : ''}`}
            onClick={() => setActiveTab('chart')}
            style={{ 
              background: activeTab === 'chart' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
              borderColor: activeTab === 'chart' ? 'var(--accent-cyan)' : 'var(--border-subtle)',
              color: activeTab === 'chart' ? '#fff' : 'var(--text-secondary)'
            }}
          >
            Telemetry Chart & Window
          </button>
          <button 
            className={`btn-secondary ${activeTab === 'samples' ? 'active' : ''}`}
            onClick={() => setActiveTab('samples')}
            style={{ 
              background: activeTab === 'samples' ? 'rgba(6, 182, 212, 0.15)' : 'transparent',
              borderColor: activeTab === 'samples' ? 'var(--accent-cyan)' : 'var(--border-subtle)',
              color: activeTab === 'samples' ? '#fff' : 'var(--text-secondary)'
            }}
          >
            Raw Odometer Audit ({odometerSamples?.length || 0} samples)
          </button>
        </div>

        {/* Chart View */}
        {activeTab === 'chart' && (
          <div>
            <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '1rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Odometer Progression (m) vs Time
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', background: 'rgba(6, 182, 212, 0.1)', padding: '0.2rem 0.6rem', borderRadius: '4px' }}>
                  Shaded Area = Loaded Window [loadingEnd → unloadingStart]
                </span>
              </div>

              {chartPoints.length > 0 ? (
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartPoints} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis 
                        dataKey="timeLabel" 
                        stroke="#64748b" 
                        fontSize={11} 
                        tickLine={false} 
                      />
                      <YAxis 
                        stroke="#64748b" 
                        fontSize={11} 
                        tickLine={false} 
                        domain={['auto', 'auto']}
                        tickFormatter={v => `${v}m`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0f172a',
                          borderColor: 'rgba(255,255,255,0.15)',
                          borderRadius: '8px',
                          fontSize: '12px'
                        }}
                        formatter={(val) => [`${val.toFixed(2)} m`, 'Cumulative Odometer']}
                        labelFormatter={(lbl) => `Time: ${lbl}`}
                      />
                      {/* Highlight the loaded window */}
                      <Line
                        type="monotone"
                        dataKey="odometer"
                        stroke="var(--accent-cyan)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 5, fill: '#06b6d4', stroke: '#fff' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                  <ShieldAlert size={32} style={{ marginBottom: '0.5rem', opacity: 0.5 }} />
                  <div>No robot telemetry samples logged during this trip's window.</div>
                  <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    Status: <strong>No Data</strong>. Estimated fallback distance is available from session summaries.
                  </div>
                </div>
              )}
            </div>

            {/* Timestamps Lifecycle Grid */}
            <h4 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Cycle Timestamps Audit
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', fontSize: '0.8rem' }}>
              <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Loading Start</div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{formatIso(trip.loadingStart)}</div>
              </div>
              <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(6, 182, 212, 0.08)', borderRadius: '8px', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
                <div style={{ color: 'var(--accent-cyan)', fontSize: '0.72rem', fontWeight: 600 }}>★ Loading End (Window Start)</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{formatIso(trip.loadingEnd)}</div>
              </div>
              <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(6, 182, 212, 0.08)', borderRadius: '8px', border: '1px solid rgba(6, 182, 212, 0.3)' }}>
                <div style={{ color: 'var(--accent-cyan)', fontSize: '0.72rem', fontWeight: 600 }}>★ Unloading Start (Window End)</div>
                <div style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>{formatIso(trip.unloadingStart)}</div>
              </div>
              <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Unloading End</div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{formatIso(trip.unloadingEnd)}</div>
              </div>
              <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Trip Start (Overall)</div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{formatIso(trip.tripStart)}</div>
              </div>
              <div style={{ padding: '0.65rem 0.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Trip End (Overall)</div>
                <div style={{ fontFamily: 'var(--font-mono)' }}>{formatIso(trip.tripEnd)}</div>
              </div>
            </div>

            {/* Overlapping Session IDs */}
            <div style={{ marginTop: '1.25rem', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-subtle)', fontSize: '0.775rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>Overlapping Robot Telemetry Sessions: </span>
              {metric?.sessionIds && metric.sessionIds.length > 0 ? (
                metric.sessionIds.map(s => (
                  <span key={s} style={{ display: 'inline-block', background: 'rgba(255,255,255,0.05)', padding: '0.15rem 0.5rem', borderRadius: '4px', margin: '0 0.25rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
                    {s}
                  </span>
                ))
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>None overlapping window</span>
              )}
            </div>
          </div>
        )}

        {/* Samples Audit Table View */}
        {activeTab === 'samples' && (
          <div style={{ maxHeight: '350px', overflowY: 'auto', border: '1px solid var(--border-subtle)', borderRadius: '8px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Timestamp</th>
                  <th>Odometer (m)</th>
                  <th>Inside Loaded Window</th>
                  <th>Session ID</th>
                </tr>
              </thead>
              <tbody>
                {odometerSamples && odometerSamples.length > 0 ? (
                  odometerSamples.map((s, idx) => {
                    const t = new Date(s.timestamp).getTime();
                    const inside = loadingEndMs && unloadingStartMs && t >= loadingEndMs && t <= unloadingStartMs;
                    return (
                      <tr key={s._id || idx} style={{ background: inside ? 'rgba(6, 182, 212, 0.05)' : 'transparent' }}>
                        <td style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{idx + 1}</td>
                        <td style={{ fontFamily: 'var(--font-mono)' }}>{new Date(s.timestamp).toISOString()}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: inside ? 'var(--accent-cyan)' : 'inherit' }}>
                          {s.odometer_m.toFixed(2)} m
                        </td>
                        <td>
                          {inside ? (
                            <span style={{ color: 'var(--accent-emerald)', fontSize: '0.75rem', fontWeight: 600 }}>YES</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Buffer</span>
                          )}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {s.sessionId}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="5" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                      No raw samples available for this time window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
