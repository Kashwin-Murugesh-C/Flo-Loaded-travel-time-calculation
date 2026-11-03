# MMR-132 Telemetry & Loaded-Transit Analytics System

A full-stack **MERN** (MongoDB, Express, React, Node.js) application engineered to ingest, deduplicate, process, and analyze **loaded-transit time and distance** telemetry per trip for the **MMR-132 material-movement robot**.

---

## 1. Mathematical Formulas & Telemetry Specification

### 1.1 The Loaded Window
For each trip, the material-loaded transit interval is strictly defined as:
$$\text{Window} = [\text{loadingEnd}, \text{unloadingStart}]$$
- $\text{loadedTimeSec} = \frac{\text{unloadingStart} - \text{loadingEnd}}{1000}$
- If $\text{loadedTimeSec} \le 0$ or timestamps are missing, the trip is marked `invalid_window` and excluded from distance calculation.
- **Cycle Time Distinction:** Notice that `tripRunningTime` from `trips.csv` is intentionally **NOT** used, because it spans the entire robot cycle (loading, transit, unloading, return trip, and idle/downtime).

### 1.2 Boundary Linear Interpolation
Odometer samples are collected at approximately 1 Hz asynchronously from trip event triggers. When the loaded window boundary $t_w$ ($\text{loadingEnd}$ or $\text{unloadingStart}$) falls between two consecutive odometer samples $(t_0, o_0)$ and $(t_1, o_1)$ such that $t_0 < t_w < t_1$, the boundary odometer reading $o(t_w)$ is computed via linear interpolation:
$$o(t_w) = o_0 + \frac{t_w - t_0}{t_1 - t_0} \times (o_1 - o_0)$$
This guarantees zero distance truncation error at window edges.

### 1.3 Measured Distance & Odometer Resets
For all odometer samples $\{o_0, o_1, \dots, o_k\}$ inside the clipped window:
$$\text{measuredDistance} = \sum_{i=0}^{k-1} \max(0, o_{i+1} - o_i)$$
- **Reset Handling:** If $o_{i+1} < o_i$, a hardware or software odometer counter reset occurred. The step $\Delta o < 0$ is ignored ($\max(0, \Delta o) = 0$), and $o_{i+1}$ initiates a new baseline.
- **Session Boundary Protection:** Distances are computed strictly **within each robot session**. The algorithm **never** computes or sums differences across gaps between different sessions.

### 1.4 Telemetry Coverage & Status Classification
$$\text{coverage} = \frac{\text{total seconds inside window spanned by valid samples}}{\text{loadedTimeSec}}$$
Trips are classified into three mutually exclusive operational tiers:
- **`measured`** ($\text{coverage} \ge 0.95$): High-confidence odometer telemetry covering at least 95% of the loaded window.
- **`partial`** ($0 < \text{coverage} < 0.95$): Partial telemetry overlap. Distance reflects only the covered sub-intervals.
- **`no_data`** ($\text{coverage} = 0$): No robot odometer telemetry recorded during the loaded window.

### 1.5 Average Loaded Speed
$$\text{avgSpeedMps} = \frac{\text{measuredDistance}}{\text{loadedTimeSec}} \quad (\text{only when } \text{status} = \text{measured})$$
Speed is **never** reported for `partial` or `no_data` trips to avoid skewing operational reporting.

### 1.6 Summary-Only Proportional Fallback ("Estimated Distance")
When odometer telemetry is unavailable or partial, a proportional estimate is calculated across all overlapping robot sessions from `sessions_summary.csv`:
$$\text{estimatedDistance} = \sum_{s \in \text{Overlapping}} \left( \text{distanceTravelled}_s \times \frac{\text{overlapSec}_s}{\text{durationSec}_s} \right)$$
> **Critical Rule:** Estimated distance is **always** labeled as an **Estimate** and is **never** presented as measured distance.

---

## 2. Empirical Data Characteristics & Limitations

Analysis of the 488 MMR-132 production trips reveals crucial operational insights:
- **Mean Loaded Telemetry Coverage:** Across all trips, mean coverage is **~8.8%** (matching the ~6–9% observed coverage limitation of the fleet).
- **Status Distribution:**
  - `measured`: **14 trips** (2.9%) with full telemetry ($\ge 95\%$ coverage).
  - `partial`: **81 trips** (16.6%) with partial telemetry coverage.
  - `no_data`: **393 trips** (80.5%) where the robot was uninstrumented, powered off, or logging in disconnected sessions during loaded transit.
- **Total Measured Distance:** $3,082.6\text{ m}$ from high-fidelity 1 Hz odometer samples.
- **Total Estimated Fallback Distance:** $1,824.2\text{ m}$ across overlapping session summaries.
- **Average Loaded Speed:** $\approx 0.36\text{ m/s}$ ($1.3\text{ km/h}$) for fully measured trips.

---

## 3. Architecture & Data Model

### Collections
1. `SessionSummary` (`session_summaries`):
   - Deduplicated on `(start, end, distanceTravelled, operationTime)`.
   - Ingests `sessions_summary.csv` ($680\text{ raw rows} \to 401\text{ unique sessions}$).
   - Compound index on `(start: 1, end: 1)`.
2. `OdometerSample` (`odometer_samples`):
   - Ingests $81,934$ samples from `sessions.jsonl`.
   - Indexed on `(sessionId: 1, timestamp: 1)` and `(timestamp: 1)`.
3. `Trip` (`trips`):
   - Ingests $488$ trips from `trips.csv`.
   - Indexed on `(loadingEnd: 1, unloadingStart: 1)`.
4. `TripMetric` (`trip_metrics`):
   - Stores precomputed, idempotent results (`tripId`, inputs, outputs, status, session IDs).

---

## 4. API Endpoints

- `POST /api/import` - Seed and deduplicate data from CSV and JSONL files.
- `POST /api/metrics/recompute` - Idempotently recompute metrics for all trips.
- `GET /api/trips?from=&to=&status=&operator=&material=&page=&limit=` - Paginated trip list with joined metrics.
- `GET /api/trips/:id` - Full trip audit detail including raw odometer samples.
- `GET /api/metrics/summary` - Aggregated KPIs, status distribution, material breakdowns, operator stats, and daily trends.

---

## 5. Verification & Testing

The pure calculation service (`server/services/tripMetrics.js`) is decoupled from database calls and verified with unit tests (`server/tests/tripMetrics.test.js`):
- [x] Negative window handling ($\text{loadingEnd} > \text{unloadingStart}$)
- [x] Missing timestamps handling
- [x] Mid-window odometer resets ($\Delta o < 0$)
- [x] Duplicate session detection
- [x] Multi-session window with telemetry gaps
- [x] Zero overlap ($\text{coverage} = 0$, `no_data`)
- [x] Full overlap ($\text{coverage} \ge 0.95$, `measured` with speed)
- [x] Linear boundary interpolation at start and end
- [x] Window inside a single inter-sample gap
- [x] Proportional summary fallback calculation

```bash
# Run unit tests
npm test
```
