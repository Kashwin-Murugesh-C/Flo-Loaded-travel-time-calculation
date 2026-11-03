import React from 'react';

export default function StatusBadge({ status, coverage, isEstimate }) {
  if (isEstimate) {
    return (
      <span className="badge badge-estimate" title="Estimated proportionally from session summary">
        <span className="badge-dot" />
        Estimate
      </span>
    );
  }

  switch (status) {
    case 'measured':
      return (
        <span className="badge badge-measured" title="Coverage ≥ 95% from odometer telemetry">
          <span className="badge-dot" />
          Measured
        </span>
      );
    case 'partial':
      return (
        <span className="badge badge-partial" title={`Partial telemetry coverage: ${((coverage || 0) * 100).toFixed(1)}%`}>
          <span className="badge-dot" />
          Partial ({((coverage || 0) * 100).toFixed(0)}%)
        </span>
      );
    case 'no_data':
    default:
      return (
        <span className="badge badge-no_data" title="No overlapping robot odometer samples found">
          <span className="badge-dot" />
          No Data
        </span>
      );
  }
}
