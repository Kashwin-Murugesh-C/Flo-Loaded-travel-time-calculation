import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Search, Filter, Eye, ChevronLeft, ChevronRight, Calendar, AlertCircle } from 'lucide-react';
import StatusBadge from '../components/StatusBadge';
import TripDetailModal from '../components/TripDetailModal';

function formatTime(seconds) {
  if (seconds == null || isNaN(seconds)) return '--:--';
  const mins = Math.floor(Math.abs(seconds) / 60);
  const secs = Math.floor(Math.abs(seconds) % 60);
  return `${seconds < 0 ? '-' : ''}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' ' + (d.getMonth() + 1) + '/' + d.getDate();
}

export default function TripsView() {
  const [trips, setTrips] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [operatorFilter, setOperatorFilter] = useState('');
  const [materialFilter, setMaterialFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Selected trip for modal
  const [selectedTripId, setSelectedTripId] = useState(null);

  const fetchTrips = () => {
    setLoading(true);
    const params = {
      page,
      limit: 20
    };
    if (statusFilter) params.status = statusFilter;
    if (operatorFilter) params.operator = operatorFilter;
    if (materialFilter) params.material = materialFilter;
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;

    axios.get('/api/trips', { params })
      .then(res => {
        setTrips(res.data.trips || []);
        setTotal(res.data.total || 0);
        setTotalPages(res.data.totalPages || 1);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch trips:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchTrips();
  }, [page, statusFilter, operatorFilter, materialFilter, fromDate, toDate]);

  return (
    <div>
      {/* Selected Trip Detail Modal */}
      {selectedTripId && (
        <TripDetailModal tripId={selectedTripId} onClose={() => setSelectedTripId(null)} />
      )}

      <div className="table-card">
        {/* Toolbar & Filters */}
        <div className="table-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 700, fontSize: '1rem', color: '#fff' }}>Trip Telemetry Records</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({total} matching)</span>
          </div>

          <div className="filter-group">
            {/* Status Filter */}
            <select
              className="filter-select"
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            >
              <option value="">All Statuses</option>
              <option value="measured">Measured (≥95% Coverage)</option>
              <option value="partial">Partial Coverage</option>
              <option value="no_data">No Data (Estimate only)</option>
            </select>

            {/* Material Filter */}
            <input
              type="text"
              placeholder="Filter Material..."
              className="filter-input"
              style={{ width: '140px' }}
              value={materialFilter}
              onChange={e => { setMaterialFilter(e.target.value); setPage(1); }}
            />

            {/* Operator Filter */}
            <input
              type="text"
              placeholder="Filter Operator..."
              className="filter-input"
              style={{ width: '140px' }}
              value={operatorFilter}
              onChange={e => { setOperatorFilter(e.target.value); setPage(1); }}
            />

            {/* From Date */}
            <input
              type="date"
              className="filter-input"
              title="From date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setPage(1); }}
            />

            {/* To Date */}
            <input
              type="date"
              className="filter-input"
              title="To date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setPage(1); }}
            />

            {(statusFilter || operatorFilter || materialFilter || fromDate || toDate) && (
              <button
                className="btn-secondary"
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem' }}
                onClick={() => {
                  setStatusFilter('');
                  setOperatorFilter('');
                  setMaterialFilter('');
                  setFromDate('');
                  setToDate('');
                  setPage(1);
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Trip ID</th>
                <th>Material</th>
                <th>Operator</th>
                <th>Window [End → Start]</th>
                <th>Loaded Time (mm:ss)</th>
                <th>Distance (m) & Classification</th>
                <th>Coverage %</th>
                <th>Avg Speed</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    Loading trips...
                  </td>
                </tr>
              ) : trips.length === 0 ? (
                <tr>
                  <td colSpan="9" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    No trips found matching the selected filters.
                  </td>
                </tr>
              ) : (
                trips.map(trip => {
                  const m = trip.metrics || {};
                  return (
                    <tr
                      key={trip.tripId}
                      onClick={() => setSelectedTripId(trip.tripId)}
                    >
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#fff' }}>
                        #{trip.tripId}
                      </td>
                      <td>
                        <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                          {trip.typeOfMaterial || 'Unspecified'}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                          Qty: {trip.quantity}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {trip.operatorName || 'Unknown'}
                      </td>
                      <td style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        <div>{formatDate(trip.loadingEnd)}</div>
                        <div>↓ {formatDate(trip.unloadingStart)}</div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                        {formatTime(m.loadedTimeSec)}
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                          {m.loadedTimeSec != null ? `${m.loadedTimeSec.toFixed(0)}s` : ''}
                        </div>
                      </td>

                      {/* Distance with NEVER SHOWING ESTIMATE AS MEASURED rule */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                          {m.status === 'measured' ? (
                            <>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent-emerald)' }}>
                                {m.measuredDistance != null ? `${m.measuredDistance.toFixed(1)} m` : '--'}
                              </span>
                              <StatusBadge status="measured" />
                            </>
                          ) : m.status === 'partial' ? (
                            <>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-amber)' }}>
                                {m.measuredDistance != null ? `${m.measuredDistance.toFixed(1)} m` : '--'}
                              </span>
                              <StatusBadge status="partial" coverage={m.coverage} />
                            </>
                          ) : m.estimatedDistance > 0 ? (
                            <>
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-purple)' }}>
                                {m.estimatedDistance.toFixed(1)} m
                              </span>
                              <StatusBadge isEstimate={true} />
                            </>
                          ) : (
                            <>
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                                --
                              </span>
                              <StatusBadge status="no_data" />
                            </>
                          )}
                        </div>
                        {/* Fallback note if applicable */}
                        {m.status !== 'measured' && m.estimatedDistance > 0 && m.status !== 'no_data' && (
                          <div style={{ fontSize: '0.7rem', color: 'var(--accent-purple)' }}>
                            Est. fallback: {m.estimatedDistance.toFixed(1)}m
                          </div>
                        )}
                      </td>

                      {/* Coverage % */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 600,
                            color: (m.coverage || 0) >= 0.95 ? 'var(--accent-emerald)' : (m.coverage || 0) > 0 ? 'var(--accent-amber)' : 'var(--text-muted)'
                          }}>
                            {m.coverage != null ? `${(m.coverage * 100).toFixed(1)}%` : '0%'}
                          </span>
                        </div>
                        <div style={{ width: '60px', height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', marginTop: '3px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.min(100, (m.coverage || 0) * 100)}%`,
                            height: '100%',
                            background: (m.coverage || 0) >= 0.95 ? 'var(--accent-emerald)' : 'var(--accent-amber)'
                          }} />
                        </div>
                      </td>

                      {/* Speed (m/s) only when status = measured */}
                      <td style={{ fontFamily: 'var(--font-mono)' }}>
                        {m.status === 'measured' && m.avgSpeedMps != null ? (
                          <div>
                            <span style={{ fontWeight: 600, color: '#fff' }}>{m.avgSpeedMps.toFixed(2)}</span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '2px' }}>m/s</span>
                          </div>
                        ) : (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>--</span>
                        )}
                      </td>

                      {/* Action */}
                      <td>
                        <button
                          className="btn-secondary"
                          style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTripId(trip.tripId);
                          }}
                        >
                          <Eye size={13} />
                          Audit
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="table-pagination">
          <div>
            Showing Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({total} total trips)
          </div>
          <div className="pagination-controls">
            <button
              className="page-btn"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              <ChevronLeft size={14} style={{ verticalAlign: 'middle' }} /> Previous
            </button>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', padding: '0 0.5rem' }}>
              {page} / {totalPages}
            </span>
            <button
              className="page-btn"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight size={14} style={{ verticalAlign: 'middle' }} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
