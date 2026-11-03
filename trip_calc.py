#!/usr/bin/env python3
"""
trip_calc.py - MMR Telemetry Loaded-Trip Time & Distance Calculator

Processes robot session telemetry exports (JSON or Mongo-shell style),
deduplicates sessions, cleans odometer glitches, detects material-loaded transit trips,
and computes high-accuracy duration, distance, and energy metrics.
"""

import sys
import os
import re
import csv
import json
import argparse
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

# Configuration Constants
ODO_UNIT = "m"  # Config constant for odometer unit (reported as 'units' in logs)
DEFAULT_LOAD_THRESHOLD = 100.0   # kg: payload > LOAD_THRESHOLD defines loaded
DEFAULT_UNLOAD_THRESHOLD = 50.0  # kg: payload < UNLOAD_THRESHOLD defines unloaded
DEFAULT_MAX_SPEED = 2.0          # units/s: steps exceeding this are odometer glitches
DEFAULT_MOTION_THRESHOLD = 0.05  # units: odometer step > 0.05 defines motion
DRIVE_ON_VOLTAGE = 20.0          # V: mmrVoltage > 20V indicates drive power active


def clean_mongo_line(line: str) -> Optional[dict]:
    """
    Parses a JSON line that may be strict JSON or Mongo-shell style.
    Handles:
      - Double('1.2'), Double("1.2"), Double(1.2)
      - NumberInt('0'), NumberInt("0"), NumberInt(0)
      - NumberLong('...'), NumberLong(...)
      - NumberDecimal('...'), NumberDecimal(...)
      - ISODate('...'), ISODate("...")
      - ObjectId('...'), ObjectId("...")
      - Timestamp(1234, 1)
      - Single-quoted keys/strings
    """
    stripped = line.strip()
    if not stripped:
        return None

    # Fast path: try strict json first
    try:
        return json.loads(stripped)
    except Exception:
        pass

    # Strip mongo shell wrappers
    text = re.sub(r"NumberInt\(['\"]?(-?\d+)['\"]?\)", r"\1", stripped)
    text = re.sub(r"NumberLong\(['\"]?(-?\d+)['\"]?\)", r"\1", text)
    text = re.sub(r"Double\(['\"]?(-?[\d\.]+(?:[eE][-+]?\d+)?)['\"]?\)", r"\1", text)
    text = re.sub(r"NumberDecimal\(['\"]?(-?[\d\.]+(?:[eE][-+]?\d+)?)['\"]?\)", r"\1", text)
    text = re.sub(r"ISODate\(['\"]([^'\"]+)['\"]\)", r'"\1"', text)
    text = re.sub(r"ObjectId\(['\"]([^'\"]+)['\"]\)", r'"\1"', text)
    text = re.sub(r"Timestamp\(\s*(\d+)\s*,\s*\d+\s*\)", r"\1", text)

    try:
        return json.loads(text)
    except Exception:
        # Normalize single quotes to double quotes for json keys and string values
        text = re.sub(r"([{,]\s*)'([a-zA-Z0-9_]+)'\s*:", r'\1"\2":', text)
        text = re.sub(r":\s*'([^']*)'", r': "\1"', text)
        text = re.sub(r"(?<=[\[,])\s*'([^']*)'\s*(?=[,\s\]])", r' "\1"', text)
        return json.loads(text)


def parse_iso(ts: str) -> float:
    """Parses ISO 8601 UTC timestamp to epoch seconds."""
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return dt.timestamp()


def merge_session_signals(session: dict) -> List[Dict[str, Any]]:
    """
    Merges asynchronous telemetry arrays (payloadWeight, distance, battery, mmr)
    into a per-second sorted table of samples.
    """
    table: Dict[str, Dict[str, Any]] = {}

    for item in session.get("distance", []):
        ts = item.get("timestamp")
        if ts:
            table.setdefault(ts, {})["distance"] = float(item.get("data", 0.0) or 0.0)

    for item in session.get("payloadWeight", []):
        ts = item.get("timestamp")
        if ts:
            table.setdefault(ts, {})["payload"] = float(item.get("data", 0.0) or 0.0)

    for item in session.get("battery", []):
        ts = item.get("timestamp")
        if ts:
            row = table.setdefault(ts, {})
            row["voltage"] = float(item.get("voltage", 0.0) or 0.0)
            row["current"] = float(item.get("current", 0.0) or 0.0)
            row["percentage"] = float(item.get("percentage", 0.0) or 0.0)

    for item in session.get("mmr", []):
        ts = item.get("timestamp")
        if ts:
            row = table.setdefault(ts, {})
            row["mmrVoltage"] = float(item.get("mmrVoltage", 0.0) or 0.0)
            row["mmrCurrent"] = float(item.get("mmrCurrent", 0.0) or 0.0)
            row["mmrPower"] = float(item.get("mmrPower", 0.0) or 0.0)

    sorted_ts = sorted(table.keys())
    merged = []
    for ts in sorted_ts:
        entry = table[ts]
        entry["timestamp"] = ts
        entry["t_epoch"] = parse_iso(ts)
        merged.append(entry)

    return merged


def process_session(session: dict,
                    load_thresh: float = DEFAULT_LOAD_THRESHOLD,
                    unload_thresh: float = DEFAULT_UNLOAD_THRESHOLD,
                    max_speed: float = DEFAULT_MAX_SPEED,
                    motion_thresh: float = DEFAULT_MOTION_THRESHOLD) -> List[Dict[str, Any]]:
    """
    Processes a single robot session:
      - Validates minimum samples and required telemetry.
      - Merges signals into per-second table.
      - Filters odometer glitches.
      - Detects loaded trips (load_complete -> trip_start -> trip_end -> unload_time).
      - Computes duration, clean distance, raw distance, speed, and stops.
    """
    p_arr = session.get("payloadWeight")
    d_arr = session.get("distance")

    if not p_arr or not d_arr:
        return []

    samples = merge_session_signals(session)
    if len(samples) < 5:
        return []

    # Check presence of distance and payload in merged table
    if not any("distance" in s for s in samples) or not any("payload" in s for s in samples):
        return []

    # Forward fill distance and payload if any isolated timestamp is missing one
    last_d = 0.0
    last_p = 0.0
    for s in samples:
        if "distance" in s:
            last_d = s["distance"]
        else:
            s["distance"] = last_d

        if "payload" in s:
            last_p = s["payload"]
        else:
            s["payload"] = last_p

    metadata = session.get("metadata") or {}
    session_id = metadata.get("sessionId", "")
    robot_id = metadata.get("robotId", "")
    session_start = session.get("timestamp") or samples[0]["timestamp"]

    trips = []
    n = len(samples)
    i = 0

    while i < n:
        # Step 3: Find load_complete: first sample where payload > load_thresh
        while i < n and samples[i]["payload"] <= load_thresh:
            i += 1
        if i >= n:
            break

        load_idx = i
        started_loaded = (load_idx == 0)

        # Find unload_time: first sample where payload falls below unload_thresh after load_complete
        unload_idx = None
        for j in range(load_idx + 1, n):
            if samples[j]["payload"] < unload_thresh:
                unload_idx = j
                break

        ended_loaded = (unload_idx is None)
        last_loaded_idx = (unload_idx - 1) if unload_idx is not None else (n - 1)

        # Find trip_start: first moving sample after load_complete
        # The trip starts at the prior sample's timestamp (when motion began, not after).
        first_moving_idx = None
        for k in range(load_idx + 1, last_loaded_idx + 1):
            raw_step = samples[k]["distance"] - samples[k - 1]["distance"]
            if raw_step > motion_thresh:
                first_moving_idx = k
                break

        if first_moving_idx is None:
            # No motion while loaded in this cycle
            i = (unload_idx + 1) if unload_idx is not None else n
            continue

        start_idx = first_moving_idx - 1

        # trip_end: the last loaded sample before unload_time.
        # If there is no unload event, use the last moving sample while still loaded and mark incomplete.
        if not ended_loaded:
            end_idx = last_loaded_idx
            is_incomplete = False
        else:
            last_moving_idx = None
            for k in range(last_loaded_idx, start_idx, -1):
                raw_step = samples[k]["distance"] - samples[k - 1]["distance"]
                if raw_step > motion_thresh:
                    last_moving_idx = k
                    break
            end_idx = last_moving_idx if last_moving_idx is not None else start_idx
            is_incomplete = True

        # Calculate trip metrics between start_idx and end_idx
        t_start_iso = samples[start_idx]["timestamp"]
        t_end_iso = samples[end_idx]["timestamp"]
        duration_s = samples[end_idx]["t_epoch"] - samples[start_idx]["t_epoch"]
        raw_odo_delta = samples[end_idx]["distance"] - samples[start_idx]["distance"]

        clean_distance = 0.0
        glitches_removed = 0
        stopped_time_s = 0.0
        battery_currents = []
        energy_wh = 0.0
        drive_on_time = 0.0

        for k in range(start_idx + 1, end_idx + 1):
            dt = samples[k]["t_epoch"] - samples[k - 1]["t_epoch"]
            raw_step = samples[k]["distance"] - samples[k - 1]["distance"]
            speed = (raw_step / dt) if dt > 0 else 0.0

            # Glitch filter: steps with speed > max_speed or negative resets are excluded from clean distance
            if speed > max_speed or raw_step < 0:
                glitches_removed += 1
                clean_step = 0.0
            else:
                clean_step = raw_step

            clean_distance += clean_step

            # Motion check after glitch filtering
            if clean_step > motion_thresh:
                pass
            else:
                stopped_time_s += dt

            # Battery & MMR power monitoring
            v = samples[k].get("voltage", 0.0)
            c = samples[k].get("current", 0.0)
            battery_currents.append(c)
            if v > 0 and c > 0 and dt > 0:
                energy_wh += (v * c * dt) / 3600.0

            mmr_v = samples[k].get("mmrVoltage", 0.0)
            if mmr_v > DRIVE_ON_VOLTAGE:
                drive_on_time += dt

        avg_speed = (clean_distance / duration_s) if duration_s > 0 else 0.0
        avg_current = (sum(battery_currents) / len(battery_currents)) if battery_currents else 0.0
        peak_current = max(battery_currents) if battery_currents else 0.0

        # Representative loaded payload (average or value at load_complete)
        loaded_payloads = [
            samples[k]["payload"]
            for k in range(start_idx, end_idx + 1)
            if samples[k]["payload"] > load_thresh
        ]
        rep_payload = (sum(loaded_payloads) / len(loaded_payloads)) if loaded_payloads else samples[start_idx]["payload"]

        flags = []
        if started_loaded:
            flags.append("started_loaded")
        if ended_loaded:
            flags.append("ended_loaded")
        if is_incomplete:
            flags.append("incomplete")
        if glitches_removed > 0:
            flags.append("glitches_removed")

        trips.append({
            "sessionId": session_id,
            "robotId": robot_id,
            "session_start": session_start,
            "trip_start": t_start_iso,
            "trip_end": t_end_iso,
            "duration_s": round(duration_s, 3),
            "distance": round(clean_distance, 3),
            "raw_odo_delta": round(raw_odo_delta, 3),
            "avg_speed": round(avg_speed, 4),
            "stopped_time_s": round(stopped_time_s, 3),
            "payload": round(rep_payload, 2),
            "glitches_removed": glitches_removed,
            "flags": ", ".join(flags),
            "load_complete_ts": samples[load_idx]["timestamp"],
            "unload_ts": samples[unload_idx]["timestamp"] if unload_idx is not None else None,
            "avg_current": round(avg_current, 2),
            "peak_current": round(peak_current, 2),
            "energy_wh": round(energy_wh, 4),
            "drive_on_time_s": round(drive_on_time, 1),
            "is_incomplete": is_incomplete,
        })

        i = (unload_idx + 1) if unload_idx is not None else n

    return trips


def load_and_deduplicate_sessions(filepath: str) -> Tuple[List[dict], int]:
    """
    Reads JSONL file, cleans Mongo wrappers, and deduplicates sessions keyed on:
      (timestamp, sessionInfo.operationTime, sessionInfo.distanceTravelled)
    Returns:
      (unique_sessions, total_raw_count)
    """
    seen_keys = set()
    unique_sessions = []
    total_raw_count = 0

    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line_str = line.strip()
            if not line_str:
                continue
            total_raw_count += 1
            session = clean_mongo_line(line_str)
            if not session:
                continue

            session_info = session.get("sessionInfo") or {}
            ts = session.get("timestamp")
            op_time = session_info.get("operationTime")
            dist = session_info.get("distanceTravelled")
            dedup_key = (ts, op_time, dist)

            if dedup_key not in seen_keys:
                seen_keys.add(dedup_key)
                unique_sessions.append(session)

    return unique_sessions, total_raw_count


def write_trips_csv(trips: List[Dict[str, Any]], output_path: str):
    """
    Writes trips to CSV matching the exact 13-column schema:
      sessionId, robotId, session_start, trip_start, trip_end, duration_s,
      distance, raw_odo_delta, avg_speed, stopped_time_s, payload,
      glitches_removed, flags
    """
    columns = [
        "sessionId",
        "robotId",
        "session_start",
        "trip_start",
        "trip_end",
        "duration_s",
        "distance",
        "raw_odo_delta",
        "avg_speed",
        "stopped_time_s",
        "payload",
        "glitches_removed",
        "flags"
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for t in trips:
            writer.writerow(t)


def plot_session_trip(session: dict,
                      trips: List[Dict[str, Any]],
                      output_path: Optional[str] = None,
                      load_thresh: float = DEFAULT_LOAD_THRESHOLD,
                      unload_thresh: float = DEFAULT_UNLOAD_THRESHOLD,
                      max_speed: float = DEFAULT_MAX_SPEED,
                      show_interactive: bool = False):
    """
    Generates a 3-panel plot for a session:
      Panel 1: Payload weight vs time, with load/unload thresholds marked
      Panel 2: Clean and raw odometer vs time, glitch steps highlighted
      Panel 3: Battery current and MMR power vs time
    Marks trip_start, trip_end, and load_complete across all panels.
    """
    try:
        import matplotlib
        if not show_interactive:
            matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("[WARN] matplotlib is not installed. Plotting skipped.", file=sys.stderr)
        return

    samples = merge_session_signals(session)
    if not samples:
        print("[WARN] No samples available to plot.", file=sys.stderr)
        return

    t0 = samples[0]["t_epoch"]
    times = [s["t_epoch"] - t0 for s in samples]
    payloads = [s.get("payload", 0.0) for s in samples]
    raw_odos = [s.get("distance", 0.0) for s in samples]
    currents = [s.get("current", 0.0) for s in samples]
    mmr_powers = [s.get("mmrPower", 0.0) for s in samples]

    # Calculate cumulative clean odometer and detect glitch points
    clean_odos = [raw_odos[0]]
    glitch_times = []
    glitch_odos = []

    for k in range(1, len(samples)):
        dt = samples[k]["t_epoch"] - samples[k - 1]["t_epoch"]
        raw_step = samples[k]["distance"] - samples[k - 1]["distance"]
        speed = (raw_step / dt) if dt > 0 else 0.0
        if speed > max_speed or raw_step < 0:
            glitch_times.append(times[k])
            glitch_odos.append(raw_odos[k])
            clean_step = 0.0
        else:
            clean_step = max(0.0, raw_step)
        clean_odos.append(clean_odos[-1] + clean_step)

    metadata = session.get("metadata") or {}
    session_id = metadata.get("sessionId", "Unknown")

    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(12, 10), sharex=True)
    fig.suptitle(f"MMR Robot Telemetry & Trip Analysis - Session {session_id}", fontsize=14, fontweight="bold")

    # Panel 1: Payload
    ax1.plot(times, payloads, color="#1f77b4", linewidth=1.5, label="Payload (kg)")
    ax1.axhline(load_thresh, color="green", linestyle="--", alpha=0.7, label=f"Load Threshold ({load_thresh} kg)")
    ax1.axhline(unload_thresh, color="red", linestyle="--", alpha=0.7, label=f"Unload Threshold ({unload_thresh} kg)")
    ax1.set_ylabel("Payload (kg)", fontweight="bold")
    ax1.grid(True, linestyle=":", alpha=0.6)
    ax1.legend(loc="upper right", framealpha=0.9)

    # Panel 2: Odometer
    ax2.plot(times, raw_odos, color="#7f7f7f", linestyle=":", linewidth=1.2, label=f"Raw Odometer ({ODO_UNIT})")
    ax2.plot(times, clean_odos, color="#2ca02c", linewidth=1.8, label=f"Clean Odometer ({ODO_UNIT})")
    if glitch_times:
        ax2.scatter(glitch_times, glitch_odos, color="red", marker="x", s=80, zorder=5, label=f"Glitch Removed ({len(glitch_times)})")
    ax2.set_ylabel(f"Odometer ({ODO_UNIT})", fontweight="bold")
    ax2.grid(True, linestyle=":", alpha=0.6)
    ax2.legend(loc="upper left", framealpha=0.9)

    # Panel 3: Battery Current & MMR Power
    ax3.plot(times, currents, color="#ff7f0e", linewidth=1.3, label="Battery Current (A)")
    ax3_twin = ax3.twinx()
    ax3_twin.plot(times, mmr_powers, color="#9467bd", linestyle="--", alpha=0.7, label="MMR Power (W)")
    ax3.set_xlabel("Elapsed Time (seconds)", fontweight="bold")
    ax3.set_ylabel("Current (A)", color="#ff7f0e", fontweight="bold")
    ax3_twin.set_ylabel("MMR Power (W)", color="#9467bd", fontweight="bold")
    ax3.grid(True, linestyle=":", alpha=0.6)

    # Combine legends for panel 3
    lines1, labels1 = ax3.get_legend_handles_labels()
    lines2, labels2 = ax3_twin.get_legend_handles_labels()
    ax3.legend(lines1 + lines2, labels1 + labels2, loc="upper right", framealpha=0.9)

    # Annotate trip markers on all subplots
    for idx, t in enumerate(trips):
        t_start_s = parse_iso(t["trip_start"]) - t0
        t_end_s = parse_iso(t["trip_end"]) - t0
        for ax in (ax1, ax2, ax3):
            ax.axvline(t_start_s, color="#2ca02c", linestyle="-.", alpha=0.8, linewidth=1.2)
            ax.axvline(t_end_s, color="#d62728", linestyle="-.", alpha=0.8, linewidth=1.2)
            ax.axvspan(t_start_s, t_end_s, color="#2ca02c", alpha=0.1)

        ax1.text(t_start_s, ax1.get_ylim()[1] * 0.9, f"Trip {idx+1} Start", rotation=90, verticalalignment="top", fontsize=9, color="#2ca02c")
        ax1.text(t_end_s, ax1.get_ylim()[1] * 0.9, f"Trip {idx+1} End", rotation=90, verticalalignment="top", fontsize=9, color="#d62728")

    plt.tight_layout()

    out_file = output_path or f"trip_{session_id}.png"
    plt.savefig(out_file, dpi=150)
    print(f"[INFO] Plot saved to: {out_file}")

    if show_interactive:
        try:
            plt.show()
        except Exception:
            pass
    plt.close()


def print_summary(total_read: int,
                  unique_count: int,
                  trips: List[Dict[str, Any]],
                  total_glitches: int):
    """Prints formatted console summary of processed sessions and trip findings."""
    complete_trips = [t for t in trips if not t["is_incomplete"]]
    incomplete_trips = [t for t in trips if t["is_incomplete"]]
    complete_sessions = len(set(t["sessionId"] for t in complete_trips))
    incomplete_sessions = len(set(t["sessionId"] for t in incomplete_trips))

    print("\n" + "=" * 70)
    print(" MMR TELEMETRY LOADED-TRIP EXTRACTION SUMMARY")
    print("=" * 70)
    print(f"  Sessions read from input : {total_read}")
    print(f"  Unique sessions processed: {unique_count}")
    print(f"  Sessions with complete trip (load -> move -> unload): {complete_sessions}")
    print(f"  Incomplete trips detected (no unload event)          : {len(incomplete_trips)} (across {incomplete_sessions} sessions)")
    print(f"  Total trips extracted                                : {len(trips)}")
    print(f"  Total odometer glitches filtered and removed        : {total_glitches}")
    print("=" * 70)

    if complete_trips:
        print("\n  COMPLETE LOADED TRIPS:")
        print(f"  {'Session ID':<30} {'Trip Start':<21} {'Dur (s)':<8} {'Dist':<8} {'Raw':<8} {'Avg Spd':<8} {'Payload':<8}")
        print("  " + "-" * 95)
        for t in complete_trips:
            sid = t["sessionId"]
            st = t["trip_start"].replace("T", " ")[:19]
            dur = f"{t['duration_s']:.1f}"
            dist = f"{t['distance']:.2f}"
            raw = f"{t['raw_odo_delta']:.2f}"
            spd = f"{t['avg_speed']:.3f}"
            pld = f"{t['payload']:.1f}"
            print(f"  {sid:<30} {st:<21} {dur:<8} {dist:<8} {raw:<8} {spd:<8} {pld:<8}")

    if incomplete_trips:
        print(f"\n  INCOMPLETE TRIPS (Showing first 5 of {len(incomplete_trips)}):")
        print(f"  {'Session ID':<30} {'Trip Start':<21} {'Dur (s)':<8} {'Dist':<8} {'Raw':<8} {'Payload':<8} {'Flags'}")
        print("  " + "-" * 105)
        for t in incomplete_trips[:5]:
            sid = t["sessionId"]
            st = t["trip_start"].replace("T", " ")[:19]
            dur = f"{t['duration_s']:.1f}"
            dist = f"{t['distance']:.2f}"
            raw = f"{t['raw_odo_delta']:.2f}"
            pld = f"{t['payload']:.1f}"
            flg = t["flags"]
            print(f"  {sid:<30} {st:<21} {dur:<8} {dist:<8} {raw:<8} {pld:<8} {flg}")
    print("=" * 70 + "\n")


def main():
    parser = argparse.ArgumentParser(
        description="Extract loaded-trip time and distance from MMR robot telemetry exports."
    )
    parser.add_argument(
        "filepath",
        nargs="?",
        default="data/sessions.jsonl",
        help="Path to sessions.jsonl input file (default: data/sessions.jsonl)"
    )
    parser.add_argument(
        "--output", "-o",
        default="trips.csv",
        help="Path for output trips CSV (default: trips.csv)"
    )
    parser.add_argument(
        "--load-threshold",
        type=float,
        default=DEFAULT_LOAD_THRESHOLD,
        help=f"Payload load threshold in kg (default: {DEFAULT_LOAD_THRESHOLD})"
    )
    parser.add_argument(
        "--unload-threshold",
        type=float,
        default=DEFAULT_UNLOAD_THRESHOLD,
        help=f"Payload unload threshold in kg (default: {DEFAULT_UNLOAD_THRESHOLD})"
    )
    parser.add_argument(
        "--max-speed",
        type=float,
        default=DEFAULT_MAX_SPEED,
        help=f"Max valid odometer speed in units/s for glitch detection (default: {DEFAULT_MAX_SPEED})"
    )
    parser.add_argument(
        "--motion-threshold",
        type=float,
        default=DEFAULT_MOTION_THRESHOLD,
        help=f"Minimum odometer step to register motion (default: {DEFAULT_MOTION_THRESHOLD})"
    )
    parser.add_argument(
        "--plot",
        metavar="SESSION_ID",
        help="Generate a 3-panel diagnostic plot for the specified session ID"
    )
    parser.add_argument(
        "--plot-output",
        help="Output filepath for generated plot image (PNG/PDF)"
    )
    parser.add_argument(
        "--show",
        action="store_true",
        help="Display interactive plot window in addition to saving file"
    )

    args = parser.parse_args()

    if not os.path.exists(args.filepath):
        print(f"[ERROR] Input file not found: {args.filepath}", file=sys.stderr)
        sys.exit(1)

    print(f"[INFO] Ingesting and deduplicating sessions from: {args.filepath} ...")
    unique_sessions, total_raw_count = load_and_deduplicate_sessions(args.filepath)
    print(f"[INFO] Ingested {total_raw_count} raw lines -> {len(unique_sessions)} unique sessions.")

    all_trips = []
    total_glitches = 0
    target_plot_session = None
    target_plot_trips = []

    for session in unique_sessions:
        metadata = session.get("metadata") or {}
        sid = metadata.get("sessionId")

        trips = process_session(
            session,
            load_thresh=args.load_threshold,
            unload_thresh=args.unload_threshold,
            max_speed=args.max_speed,
            motion_thresh=args.motion_threshold
        )

        for t in trips:
            all_trips.append(t)
            total_glitches += t["glitches_removed"]

        if args.plot and sid == args.plot:
            target_plot_session = session
            target_plot_trips = trips

    # Write CSV
    write_trips_csv(all_trips, args.output)
    print(f"[INFO] Extracted {len(all_trips)} trips written to: {args.output}")

    # Print Summary
    print_summary(total_raw_count, len(unique_sessions), all_trips, total_glitches)

    # Plot if requested
    if args.plot:
        if target_plot_session:
            plot_session_trip(
                target_plot_session,
                target_plot_trips,
                output_path=args.plot_output,
                load_thresh=args.load_threshold,
                unload_thresh=args.unload_threshold,
                max_speed=args.max_speed,
                show_interactive=args.show
            )
        else:
            print(f"[WARN] Requested plot session ID '{args.plot}' was not found in dataset.", file=sys.stderr)


if __name__ == "__main__":
    main()
