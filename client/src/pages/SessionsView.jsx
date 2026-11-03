import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  Search,
  Filter,
  Eye,
  ChevronLeft,
  ChevronRight,
  Calendar,
  AlertCircle,
  Bot,
  Activity,
  Layers,
  Weight,
  Gauge,
  RotateCcw
} from 'lucide-react';
import SessionDetailModal from '../components/SessionDetailModal';

function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) return '--';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function formatDate(iso) {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return `${dateStr} ${timeStr}`;
}

export default function SessionsView() {
  const [sessions, setSessions] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [hasTripsFilter, setHasTripsFilter] = useState('all'); // 'all' | 'true' | 'false'
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Selected session for modal
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  const fetchSessions = () => {
    setLoading(true);
    const params = {
      page,
      limit: 20
    };
    if (search) params.search = search;
    if (hasTripsFilter !== 'all') params.hasTrips = hasTripsFilter;
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;

    axios.get('/api/sessions', { params })
      .then(res => {
        setSessions(res.data.sessions || []);
        setTotal(res.data.total || 0);
        setTotalPages(res.data.totalPages || 1);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch sessions:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchSessions();
  }, [page, hasTripsFilter, fromDate, toDate]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchSessions();
  };

  const handleReset = () => {
    setSearch('');
    setHasTripsFilter('all');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  return (
    <div className="trips-view">
      {/* Title & Stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            Robot Telemetry Sessions &amp; Loaded Trips
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Ingested from MongoDB export. Grouped and separated by session with loaded-trip calculation (trip_calc engine).
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="badge badge-measured" style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem' }}>
            <span className="badge-dot" />
            401 Unique Sessions Ingested
          </div>
          <div className="badge badge-partial" style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem' }}>
            <span className="badge-dot" />
            57 Loaded Trips Extracted
          </div>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="filter-card">
        <form onSubmit={handleSearchSubmit} style={{ display: 'flex', gap: '0.75rem', flex: 1, minWidth: '240px' }}>
          <div className="search-input-wrapper" style={{ flex: 1 }}>
            <Search size={16} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search by Session ID, Robot ID, or Name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Trip Status Filter */}
          <select
            className="filter-select"
            value={hasTripsFilter}
            onChange={(e) => { setHasTripsFilter(e.target.value); setPage(1); }}
          >
            <option value="all">All Sessions (401)</option>
            <option value="true">With Loaded Trips Only (57)</option>
            <option value="false">Without Trips (344)</option>
          </select>

          {/* Date Range */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input
              type="date"
              className="filter-input date-input"
              value={fromDate}
              onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
              title="From session start date"
            />
            <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
            <input
              type="date"
              className="filter-input date-input"
              value={toDate}
              onChange={(e) => { setToDate(e.target.value); setPage(1); }}
              title="To session start date"
            />
          </div>

          <button className="btn-icon" onClick={handleReset} title="Reset all filters">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* Table Header / Count Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0 0.5rem' }}>
        <div style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
          Showing {sessions.length} of {total} sessions
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Page {page} of {totalPages}
        </div>
      </div>

      {/* Sessions Table */}
      <div className="table-container">
        <table className="telemetry-table">
          <thead>
            <tr>
              <th>Session ID</th>
              <th>Robot ID</th>
              <th>Date &amp; Time (UTC)</th>
              <th>Op Time</th>
              <th>Odo (m)</th>
              <th>Loaded Trips</th>
              <th>Clean Dist</th>
              <th>Raw Delta</th>
              <th>Duration</th>
              <th>Payload</th>
              <th>Flags</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan="12" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  Loading sessions and loaded trip calculations...
                </td>
              </tr>
            ) : sessions.length === 0 ? (
              <tr>
                <td colSpan="12" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                  <AlertCircle size={24} style={{ margin: '0 auto 0.5rem', display: 'block', opacity: 0.5 }} />
                  No robot sessions found matching the selected filters.
                </td>
              </tr>
            ) : (
              sessions.map((sess) => {
                const primaryTrip = sess.trips && sess.trips.length > 0 ? sess.trips[0] : null;
                return (
                  <tr key={sess.sessionId}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      <span
                        style={{ cursor: 'pointer', color: 'var(--accent-cyan)' }}
                        onClick={() => setSelectedSessionId(sess.sessionId)}
                        title="Click to view full session telemetry and charts"
                      >
                        {sess.sessionId}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {sess.robotId ? `${sess.robotId.substring(0, 8)}...` : '--'}
                    </td>
                    <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                      {formatDate(sess.start)}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {(sess.operationTime / 1000).toFixed(0)}s
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {sess.distanceTravelled != null ? sess.distanceTravelled.toFixed(1) : '--'}
                    </td>
                    <td>
                      {sess.tripsCount > 0 ? (
                        <span className="badge badge-measured" style={{ fontSize: '0.72rem' }}>
                          <span className="badge-dot" />
                          {sess.tripsCount} Trip{sess.tripsCount > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="badge badge-no_data" style={{ fontSize: '0.72rem' }}>
                          0 Trips
                        </span>
                      )}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: primaryTrip ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
                      {primaryTrip ? `${primaryTrip.distance.toFixed(1)} m` : '--'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {primaryTrip ? `${primaryTrip.raw_odo_delta.toFixed(1)} m` : '--'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: primaryTrip ? 'var(--accent-cyan)' : 'inherit' }}>
                      {primaryTrip ? `${primaryTrip.duration_s}s` : '--'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                      {primaryTrip ? `${primaryTrip.payload.toFixed(0)} kg` : '--'}
                    </td>
                    <td style={{ maxWidth: '180px' }}>
                      {primaryTrip ? (
                        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                          {primaryTrip.flags.split(', ').map((flag, fIdx) => (
                            <span
                              key={fIdx}
                              className={`badge ${flag === 'incomplete' ? 'badge-partial' : flag.includes('glitch') ? 'badge-estimate' : 'badge-measured'}`}
                              style={{ fontSize: '0.68rem', padding: '0.15rem 0.4rem' }}
                            >
                              {flag}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>No load motion</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn-secondary"
                        style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        onClick={() => setSelectedSessionId(sess.sessionId)}
                        title="View session telemetry details and 3-panel chart"
                      >
                        <Eye size={13} />
                        View
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.25rem' }}>
        <button
          className="btn-secondary"
          onClick={() => setPage(p => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <ChevronLeft size={16} /> Previous
        </button>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Page {page} of {totalPages}
        </span>
        <button
          className="btn-secondary"
          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages || loading}
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          Next <ChevronRight size={16} />
        </button>
      </div>

      {/* Detail Modal */}
      {selectedSessionId && (
        <SessionDetailModal
          sessionId={selectedSessionId}
          onClose={() => setSelectedSessionId(null)}
        />
      )}
    </div>
  );
}
