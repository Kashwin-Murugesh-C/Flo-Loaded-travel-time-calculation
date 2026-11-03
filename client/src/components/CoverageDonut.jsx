import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';

const COLORS = {
  measured: '#10b981', // emerald
  partial: '#f59e0b',  // amber
  no_data: '#475569'   // slate
};

const LABELS = {
  measured: 'Measured (≥95% Coverage)',
  partial: 'Partial (0 < Cov < 95%)',
  no_data: 'No Data (0% Coverage)'
};

export default function CoverageDonut({ byStatus, total }) {
  if (!byStatus || total === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
        No metric data available
      </div>
    );
  }

  const data = [
    { name: LABELS.measured, key: 'measured', value: byStatus.measured || 0, color: COLORS.measured },
    { name: LABELS.partial, key: 'partial', value: byStatus.partial || 0, color: COLORS.partial },
    { name: LABELS.no_data, key: 'no_data', value: byStatus.no_data || 0, color: COLORS.no_data }
  ].filter(d => d.value > 0);

  const usableCount = (byStatus.measured || 0) + (byStatus.partial || 0);
  const usablePercent = total > 0 ? ((usableCount / total) * 100).toFixed(1) : 0;

  return (
    <div style={{ position: 'relative', width: '100%', height: '240px' }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={65}
            outerRadius={90}
            paddingAngle={4}
            dataKey="value"
          >
            {data.map((entry) => (
              <Cell key={`cell-${entry.key}`} fill={entry.color} stroke="rgba(0,0,0,0.5)" strokeWidth={2} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: '#0f172a',
              borderColor: 'rgba(255,255,255,0.15)',
              borderRadius: '8px',
              fontSize: '12px'
            }}
            formatter={(value, name) => [
              `${value} trips (${((value / total) * 100).toFixed(1)}%)`,
              name
            ]}
          />
          <Legend
            verticalAlign="bottom"
            height={36}
            iconType="circle"
            formatter={(val) => <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{val}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
      
      {/* Center Statistic */}
      <div style={{
        position: 'absolute',
        top: '40%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        textAlign: 'center',
        pointerEvents: 'none'
      }}>
        <div style={{ fontSize: '1.4rem', fontWeight: 800, fontFamily: 'var(--font-mono)', color: '#fff' }}>
          {usablePercent}%
        </div>
        <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
          Usable Trips
        </div>
      </div>
    </div>
  );
}
