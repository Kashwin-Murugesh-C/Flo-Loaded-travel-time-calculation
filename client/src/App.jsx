import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  LayoutDashboard,
  Table,
  RotateCcw,
  UploadCloud,
  Bot,
  Activity,
  CheckCircle2
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import TripsView from './pages/TripsView';
import SessionsView from './pages/SessionsView';

export default function App() {
  const [activeTab, setActiveTab] = useState('sessions'); // 'sessions' | 'dashboard' | 'trips'
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const fetchSummary = async () => {
    try {
      const res = await axios.get('/api/metrics/summary');
      setSummary(res.data);
      setLoading(false);
    } catch (err) {
      console.error('Failed to load metrics summary:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  const handleRecompute = async () => {
    setIsActionLoading(true);
    try {
      await axios.post('/api/metrics/recompute');
      await fetchSummary();
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleImport = async () => {
    setIsActionLoading(true);
    try {
      await axios.post('/api/import');
      await axios.post('/api/metrics/recompute');
      await fetchSummary();
    } finally {
      setIsActionLoading(false);
    }
  };

  return (
    <div className="app-container">
      {/* Navbar */}
      <header className="navbar">
        <div className="brand">
          <div className="brand-icon">
            <Bot size={22} color="#fff" />
          </div>
          <div>
            <div className="brand-title">MMR-132 Telemetry Engine</div>
            <div className="brand-subtitle">Loaded-Transit Time & Distance Analytics</div>
          </div>
        </div>

        <nav className="nav-links">
          <button
            className={`nav-btn ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            <Activity size={16} />
            Robot Sessions &amp; Loaded Trips
          </button>
          <button
            className={`nav-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={16} />
            Fleet Dashboard
          </button>
          <button
            className={`nav-btn ${activeTab === 'trips' ? 'active' : ''}`}
            onClick={() => setActiveTab('trips')}
          >
            <Table size={16} />
            Trips Explorer
          </button>
        </nav>

        <div className="nav-actions">
          <button
            className="btn-secondary"
            onClick={handleImport}
            disabled={isActionLoading}
            title="Import and deduplicate from CSV/JSONL source files"
          >
            <UploadCloud size={15} />
            {isActionLoading ? 'Working...' : 'Re-Seed'}
          </button>
          <button
            className="btn-primary"
            onClick={handleRecompute}
            disabled={isActionLoading}
            title="Recompute all trip metrics idempotently"
          >
            <RotateCcw size={15} />
            {isActionLoading ? 'Processing...' : 'Recompute Metrics'}
          </button>
        </div>
      </header>

      {/* Main Content Body */}
      <main className="main-content">
        {activeTab === 'sessions' && <SessionsView />}
        {activeTab === 'dashboard' && (
          <Dashboard
            summary={summary}
            onRecompute={handleRecompute}
            onImport={handleImport}
            isActionLoading={isActionLoading}
          />
        )}
        {activeTab === 'trips' && <TripsView />}
      </main>

      {/* Footer */}
      <footer style={{
        padding: '1.25rem 2rem',
        borderTop: '1px solid var(--border-subtle)',
        textAlign: 'center',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        background: 'rgba(16, 22, 34, 0.5)'
      }}>
        MMR-132 Material Movement Robot • Loaded Window: <code style={{ color: 'var(--accent-cyan)' }}>[loadingEnd, unloadingStart]</code> •
        Confidence Threshold: <code style={{ color: 'var(--accent-emerald)' }}>Coverage ≥ 95%</code> •
        Pure Computation Service with Boundary Interpolation
      </footer>
    </div>
  );
}
