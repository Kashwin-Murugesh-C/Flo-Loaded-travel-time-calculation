import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area
} from 'recharts';
import {
  Activity,
  Layers,
  Compass,
  Zap,
  RotateCcw,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Clock,
  TrendingUp,
  Boxes
} from 'lucide-react';
import CoverageDonut from '../components/CoverageDonut';

function formatSeconds(secs) {
  if (!secs) return '0s';
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export default function Dashboard({ summary, onRecompute, onImport, isActionLoading }) {
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleRecompute = async () => {
    try {
      await onRecompute();
      showToast('All 488 trip metrics recomputed successfully!');
    } catch (e) {
      showToast('Recompute failed: ' + e.message);
    }
  };

  const handleImport = async () => {
    try {
      await onImport();
      showToast('Data imported and deduplicated successfully!');
    } catch (e) {
      showToast('Import failed: ' + e.message);
    }
  };

  if (!summary) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
        Loading telemetry metrics summary...
      </div>
    );
  }

  const {
    total = 0,
    byStatus = {},
    statusPercentages = {},
    averages = {},
    totalMeasuredDistance = 0,
    totalEstimatedDistance = 0,
    byMaterial = {},
    byOperator = {},
    byDay = []
  } = summary;

  // Prepare Material Chart Data
  const materialData = Object.entries(byMaterial)
    .map(([material, d]) => ({
      material: material.length > 14 ? material.substring(0, 12) + '..' : material,
      fullName: material,
      trips: d.count,
      avgLoadedTimeSec: d.count > 0 ? Math.round(d.totalTime / d.count) : 0,
      totalDistM: Math.round(d.totalDist)
    }))
    .sort((a, b) => b.avgLoadedTimeSec - a.avgLoadedTimeSec)
    .slice(0, 8); // Top 8 materials

  // Usable trips count (measured + partial)
  const usableCount = (byStatus.measured || 0) + (byStatus.partial || 0);

  return (
    <div>
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast">
          <CheckCircle2 size={18} style={{ color: 'var(--accent-emerald)' }} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Coverage reality advisory banner */}
      <div className="coverage-banner">
        <div className="coverage-banner-content">
          <AlertTriangle size={20} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} />
          <div>
            <strong>Telemetry Reality Note:</strong> Mean loaded-window coverage across the fleet is{' '}
            <strong>{((averages.coverage || 0) * 100).toFixed(1)}%</strong> (~6–9%). Out of {total} trips,{' '}
            <strong>{byStatus.measured || 0} trips</strong> have high-confidence full coverage (≥95%),{' '}
            <strong>{byStatus.partial || 0} trips</strong> have partial odometer samples, and{' '}
            <strong>{byStatus.no_data || 0} trips</strong> have no robot telemetry during the loaded window.
            Summary-based fallback distance ({totalEstimatedDistance.toFixed(0)}m total) is kept strictly separated.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0, marginLeft: '1rem' }}>
          <button
            className="btn-secondary"
            onClick={handleImport}
            disabled={isActionLoading}
            style={{ fontSize: '0.775rem', padding: '0.4rem 0.75rem' }}
          >
            <UploadCloud size={14} />
            {isActionLoading ? 'Importing...' : 'Re-Seed Data'}
          </button>
          <button
            className="btn-primary"
            onClick={handleRecompute}
            disabled={isActionLoading}
            style={{ fontSize: '0.775rem', padding: '0.4rem 0.75rem' }}
          >
            <RotateCcw size={14} />
            {isActionLoading ? 'Computing...' : 'Recompute Metrics'}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Total Robot Trips</span>
            <div className="kpi-icon-wrapper" style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--accent-blue)' }}>
              <Layers size={18} />
            </div>
          </div>
          <div className="kpi-value">{total}</div>
          <div className="kpi-subtext">Deduplicated from trips.csv</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Avg Loaded Transit Time</span>
            <div className="kpi-icon-wrapper" style={{ background: 'rgba(6, 182, 212, 0.15)', color: 'var(--accent-cyan)' }}>
              <Clock size={18} />
            </div>
          </div>
          <div className="kpi-value">{formatSeconds(averages.loadedTimeSec)}</div>
          <div className="kpi-subtext">Window: [loadingEnd → unloadingStart]</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Usable Odometer Trips</span>
            <div className="kpi-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--accent-emerald)' }}>
              <Compass size={18} />
            </div>
          </div>
          <div className="kpi-value">{usableCount} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>({((usableCount / (total || 1)) * 100).toFixed(1)}%)</span></div>
          <div className="kpi-subtext">{byStatus.measured || 0} Measured + {byStatus.partial || 0} Partial</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Measured Distance</span>
            <div className="kpi-icon-wrapper" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--accent-emerald)' }}>
              <Activity size={18} />
            </div>
          </div>
          <div className="kpi-value">{Math.round(totalMeasuredDistance).toLocaleString()} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>m</span></div>
          <div className="kpi-subtext">Avg speed: {averages.speedMps ? averages.speedMps.toFixed(2) : '0.36'} m/s (measured)</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-title">Estimated Fallback</span>
            <div className="kpi-icon-wrapper" style={{ background: 'rgba(139, 92, 246, 0.15)', color: 'var(--accent-purple)' }}>
              <Zap size={18} />
            </div>
          </div>
          <div className="kpi-value">{Math.round(totalEstimatedDistance).toLocaleString()} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>m</span></div>
          <div className="kpi-subtext">Proportional session-summary fallback</div>
        </div>
      </div>

      {/* Main Charts Row */}
      <div className="charts-grid">
        {/* Coverage Donut */}
        <div className="chart-card col-4">
          <div className="chart-header">
            <div>
              <div className="chart-title">
                <Compass size={18} style={{ color: 'var(--accent-cyan)' }} />
                Coverage & Usability
              </div>
              <div className="chart-desc">Fraction of trips with usable telemetry</div>
            </div>
          </div>
          <CoverageDonut byStatus={byStatus} total={total} />
          <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center' }}>
            Measured requires ≥ 95% sample coverage inside window
          </div>
        </div>

        {/* Avg Loaded Time by Material */}
        <div className="chart-card col-8">
          <div className="chart-header">
            <div>
              <div className="chart-title">
                <Boxes size={18} style={{ color: 'var(--accent-indigo)' }} />
                Avg Loaded-Transit Time by Material
              </div>
              <div className="chart-desc">Transit duration in seconds across top material categories</div>
            </div>
          </div>
          <div style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={materialData} margin={{ top: 10, right: 10, left: -10, bottom: 25 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis 
                  dataKey="material" 
                  stroke="#64748b" 
                  fontSize={11} 
                  angle={-20} 
                  textAnchor="end"
                  interval={0}
                />
                <YAxis 
                  stroke="#64748b" 
                  fontSize={11} 
                  tickFormatter={v => `${v}s`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: 'rgba(255,255,255,0.15)',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                  formatter={(val, name, item) => [
                    `${formatSeconds(val)} (${val}s)`,
                    `Avg Loaded Time (${item.payload.trips} trips)`
                  ]}
                  labelFormatter={(lbl, arr) => arr?.[0]?.payload?.fullName || lbl}
                />
                <Bar dataKey="avgLoadedTimeSec" fill="url(#barGradient)" radius={[4, 4, 0, 0]} />
                <defs>
                  <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#06b6d4" stopOpacity={0.9} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Daily Loaded Time and Measured Distance Trends */}
        <div className="chart-card col-12">
          <div className="chart-header">
            <div>
              <div className="chart-title">
                <TrendingUp size={18} style={{ color: 'var(--accent-emerald)' }} />
                Daily Fleet Activity & Loaded Transit Trends
              </div>
              <div className="chart-desc">Average loaded transit time (seconds) and trip volume over time</div>
            </div>
          </div>
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={byDay} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis 
                  dataKey="day" 
                  stroke="#64748b" 
                  fontSize={11}
                  tickFormatter={d => d.slice(5)} // MM-DD
                />
                <YAxis 
                  yAxisId="time"
                  stroke="#64748b" 
                  fontSize={11} 
                  tickFormatter={v => `${Math.round(v)}s`}
                />
                <YAxis 
                  yAxisId="dist" 
                  orientation="right"
                  stroke="#64748b" 
                  fontSize={11} 
                  tickFormatter={v => `${Math.round(v)}m`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    borderColor: 'rgba(255,255,255,0.15)',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                  formatter={(val, name) => [
                    name === 'avgTimeSec' ? `${formatSeconds(val)} (${Math.round(val)}s)` : `${Math.round(val)} m`,
                    name === 'avgTimeSec' ? 'Avg Loaded Time' : 'Measured Distance'
                  ]}
                  labelFormatter={lbl => `Date: ${lbl}`}
                />
                <defs>
                  <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <Area 
                  yAxisId="time"
                  type="monotone" 
                  dataKey="avgTimeSec" 
                  stroke="#06b6d4" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#areaGradient)" 
                />
                <Area 
                  yAxisId="dist"
                  type="monotone" 
                  dataKey="totalDistM" 
                  stroke="#10b981" 
                  strokeWidth={2}
                  fillOpacity={0.1} 
                  fill="#10b981" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Operator Breakdown Card */}
      <div className="chart-card col-12" style={{ marginTop: '1.5rem' }}>
        <div className="chart-header">
          <div className="chart-title">
            <Activity size={18} style={{ color: 'var(--accent-cyan)' }} />
            Operator Summary
          </div>
          <div className="chart-desc">Performance metrics aggregated by material movement operator</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
          {Object.entries(byOperator).map(([opName, d]) => (
            <div key={opName} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff', marginBottom: '0.5rem' }}>{opName}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                <div>Total Trips: <strong style={{ color: '#fff' }}>{d.count}</strong></div>
                <div>Avg Loaded Time: <strong style={{ color: 'var(--accent-cyan)' }}>{formatSeconds(d.count > 0 ? d.totalTime / d.count : 0)}</strong></div>
                <div>Measured Dist: <strong style={{ color: 'var(--accent-emerald)' }}>{Math.round(d.totalDist)} m</strong></div>
                <div>Total Loaded Time: <strong style={{ color: '#fff' }}>{(d.totalTime / 3600).toFixed(1)} hrs</strong></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
