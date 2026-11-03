#!/usr/bin/env python3
"""
test_trip_calc.py - Automated Unit Tests for trip_calc.py

Tests:
1. Mongo-shell string cleaner with various wrappers and quote formats.
2. Signal merging and timestamp ordering.
3. Glitch filtering (high-speed jumps and negative odometer steps).
4. Motion detection and hysteresis thresholds.
5. End-to-end extraction against all 5 reference sessions in data/sessions.jsonl.
"""

import unittest
import os
import json
from trip_calc import (
    clean_mongo_line,
    parse_iso,
    merge_session_signals,
    process_session,
    load_and_deduplicate_sessions,
)

SESSIONS_FILE = "data/sessions.jsonl"


class TestMongoCleaner(unittest.TestCase):
    def test_strict_json(self):
        line = '{"key": "value", "count": 10, "active": true}'
        res = clean_mongo_line(line)
        self.assertEqual(res, {"key": "value", "count": 10, "active": True})

    def test_mongo_wrappers(self):
        line = (
            '{"val": Double("1.2"), "count": NumberInt("0"), '
            '"id": ObjectId("6a8bd09333021b2c94190950"), '
            '"ts": ISODate("2026-09-25T07:00:51.000Z"), '
            '"big": NumberLong("9876543210"), '
            '"dec": NumberDecimal("12.345"), '
            '"clock": Timestamp(1600000000, 1)}'
        )
        res = clean_mongo_line(line)
        self.assertIsNotNone(res)
        self.assertEqual(res["val"], 1.2)
        self.assertEqual(res["count"], 0)
        self.assertEqual(res["id"], "6a8bd09333021b2c94190950")
        self.assertEqual(res["ts"], "2026-09-25T07:00:51.000Z")
        self.assertEqual(res["big"], 9876543210)
        self.assertEqual(res["dec"], 12.345)
        self.assertEqual(res["clock"], 1600000000)

    def test_single_quoted_json(self):
        line = "{'name': 'robot-1', 'active': true, 'tags': ['tag1', 'tag2'], 'score': Double(42.5)}"
        res = clean_mongo_line(line)
        self.assertIsNotNone(res)
        self.assertEqual(res["name"], "robot-1")
        self.assertEqual(res["active"], True)
        self.assertEqual(res["tags"], ["tag1", "tag2"])
        self.assertEqual(res["score"], 42.5)


class TestTripCalculations(unittest.TestCase):
    def test_glitch_filter_synthetic(self):
        # 1 Hz sampling with an 80m jump in 1 second
        session = {
            "metadata": {"sessionId": "synthetic-test", "robotId": "MMR-1"},
            "timestamp": "2026-01-01T00:00:00.000Z",
            "payloadWeight": [
                {"timestamp": f"2026-01-01T00:00:0{i}.000Z", "data": 200.0} for i in range(6)
            ],
            "distance": [
                {"timestamp": "2026-01-01T00:00:00.000Z", "data": 0.0},
                {"timestamp": "2026-01-01T00:00:01.000Z", "data": 0.5},   # normal step 0.5m/s
                {"timestamp": "2026-01-01T00:00:02.000Z", "data": 85.5},  # GLITCH step 85.0m/s
                {"timestamp": "2026-01-01T00:00:03.000Z", "data": 86.0},  # normal step 0.5m/s
                {"timestamp": "2026-01-01T00:00:04.000Z", "data": 86.0},  # stop
                {"timestamp": "2026-01-01T00:00:05.000Z", "data": 86.0},  # stop
            ]
        }
        # Add unload at second 5
        session["payloadWeight"][-1]["data"] = 10.0

        trips = process_session(session, load_thresh=100.0, unload_thresh=50.0, max_speed=2.0)
        self.assertEqual(len(trips), 1)
        trip = trips[0]

        # Raw distance delta is 86.0 - 0.0 = 86.0
        self.assertAlmostEqual(trip["raw_odo_delta"], 86.0, places=2)
        # Clean distance excludes the 85.0m jump: 0.5 + 0.5 = 1.0m
        self.assertAlmostEqual(trip["distance"], 1.0, places=2)
        self.assertEqual(trip["glitches_removed"], 1)

    def test_negative_odometer_step(self):
        # Odometer resets from 100 to 0
        session = {
            "metadata": {"sessionId": "reset-test", "robotId": "MMR-1"},
            "timestamp": "2026-01-01T00:00:00.000Z",
            "payloadWeight": [
                {"timestamp": f"2026-01-01T00:00:0{i}.000Z", "data": 150.0} for i in range(6)
            ],
            "distance": [
                {"timestamp": "2026-01-01T00:00:00.000Z", "data": 100.0},
                {"timestamp": "2026-01-01T00:00:01.000Z", "data": 100.3},
                {"timestamp": "2026-01-01T00:00:02.000Z", "data": 0.0},   # reset / glitch
                {"timestamp": "2026-01-01T00:00:03.000Z", "data": 0.4},
                {"timestamp": "2026-01-01T00:00:04.000Z", "data": 0.8},
                {"timestamp": "2026-01-01T00:00:05.000Z", "data": 0.8},
            ]
        }
        session["payloadWeight"][-1]["data"] = 0.0  # unload

        trips = process_session(session, load_thresh=100.0, unload_thresh=50.0, max_speed=2.0)
        self.assertEqual(len(trips), 1)
        trip = trips[0]
        # Clean distance: 0.3 + 0.4 + 0.4 = 1.1 (the negative step is excluded)
        self.assertAlmostEqual(trip["distance"], 1.1, places=2)
        self.assertEqual(trip["glitches_removed"], 1)


class TestReferenceSessions(unittest.TestCase):
    """
    Validates calculations against the 5 known reference sessions in data/sessions.jsonl.
    """
    @classmethod
    def setUpClass(cls):
        cls.sessions = {}
        if os.path.exists(SESSIONS_FILE):
            with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    s = clean_mongo_line(line)
                    if s:
                        meta = s.get("metadata") or {}
                        sid = meta.get("sessionId")
                        if sid:
                            cls.sessions[sid] = s

    def test_reference_session_1(self):
        # 20260925-123051-75374799: 83.0s, 10.3m clean, 13.6m raw, 1 glitch
        sid = "20260925-123051-75374799"
        self.assertIn(sid, self.sessions)
        trips = process_session(self.sessions[sid])
        self.assertEqual(len(trips), 1)
        t = trips[0]
        self.assertEqual(t["trip_start"], "2026-09-25T07:00:55.000Z")
        self.assertEqual(t["trip_end"], "2026-09-25T07:02:18.000Z")
        self.assertAlmostEqual(t["duration_s"], 83.0, places=1)
        self.assertAlmostEqual(t["distance"], 10.3, places=1)
        self.assertAlmostEqual(t["raw_odo_delta"], 13.6, places=1)
        self.assertAlmostEqual(t["payload"], 225.86, places=1)
        self.assertEqual(t["glitches_removed"], 1)
        self.assertFalse(t["is_incomplete"])

    def test_reference_session_2(self):
        # 20260920-115407-519493e1: 18.0s, 2.8m clean, 2.8m raw, 0 glitches
        sid = "20260920-115407-519493e1"
        self.assertIn(sid, self.sessions)
        trips = process_session(self.sessions[sid])
        self.assertEqual(len(trips), 1)
        t = trips[0]
        self.assertEqual(t["trip_start"], "2026-09-20T06:24:14.000Z")
        self.assertEqual(t["trip_end"], "2026-09-20T06:24:32.000Z")
        self.assertAlmostEqual(t["duration_s"], 18.0, places=1)
        self.assertAlmostEqual(t["distance"], 2.8, places=1)
        self.assertAlmostEqual(t["raw_odo_delta"], 2.8, places=1)
        self.assertAlmostEqual(t["payload"], 372.53, places=1)
        self.assertEqual(t["glitches_removed"], 0)
        self.assertFalse(t["is_incomplete"])

    def test_reference_session_3(self):
        # 20261008-153742-7e3da610: 5.0s, 1.0m clean, 1.0m raw, 0 glitches
        sid = "20261008-153742-7e3da610"
        self.assertIn(sid, self.sessions)
        trips = process_session(self.sessions[sid])
        self.assertEqual(len(trips), 1)
        t = trips[0]
        self.assertEqual(t["trip_start"], "2026-10-08T10:07:47.000Z")
        self.assertEqual(t["trip_end"], "2026-10-08T10:07:52.000Z")
        self.assertAlmostEqual(t["duration_s"], 5.0, places=1)
        self.assertAlmostEqual(t["distance"], 1.0, places=1)
        self.assertAlmostEqual(t["raw_odo_delta"], 1.0, places=1)
        self.assertAlmostEqual(t["payload"], 364.84, places=1)
        self.assertEqual(t["glitches_removed"], 0)
        self.assertFalse(t["is_incomplete"])

    def test_reference_session_4(self):
        # 20261012-120659-abc290d5: 3.0s, 0.7m clean, 8.8m raw, 1 glitch
        sid = "20261012-120659-abc290d5"
        self.assertIn(sid, self.sessions)
        trips = process_session(self.sessions[sid])
        self.assertEqual(len(trips), 1)
        t = trips[0]
        self.assertEqual(t["trip_start"], "2026-10-12T06:37:05.000Z")
        self.assertEqual(t["trip_end"], "2026-10-12T06:37:08.000Z")
        self.assertAlmostEqual(t["duration_s"], 3.0, places=1)
        self.assertAlmostEqual(t["distance"], 0.7, places=1)
        self.assertAlmostEqual(t["raw_odo_delta"], 8.8, places=1)
        self.assertAlmostEqual(t["payload"], 343.39, places=1)
        self.assertEqual(t["glitches_removed"], 1)
        self.assertFalse(t["is_incomplete"])

    def test_reference_session_5(self):
        # 20260828-114939-bcb3da46: 2.0s, 0.0m clean, 107.7m raw, 2 glitches, incomplete
        sid = "20260828-114939-bcb3da46"
        self.assertIn(sid, self.sessions)
        trips = process_session(self.sessions[sid])
        self.assertEqual(len(trips), 1)
        t = trips[0]
        self.assertEqual(t["trip_start"], "2026-08-28T06:19:58.000Z")
        self.assertEqual(t["trip_end"], "2026-08-28T06:20:00.000Z")
        self.assertAlmostEqual(t["duration_s"], 2.0, places=1)
        self.assertAlmostEqual(t["distance"], 0.0, places=1)
        self.assertAlmostEqual(t["raw_odo_delta"], 107.7, places=1)
        self.assertAlmostEqual(t["payload"], 349.98, places=1)
        self.assertEqual(t["glitches_removed"], 2)
        self.assertTrue(t["is_incomplete"])
        self.assertIn("started_loaded", t["flags"])
        self.assertIn("ended_loaded", t["flags"])
        self.assertIn("incomplete", t["flags"])


class TestDeduplication(unittest.TestCase):
    def test_deduplication(self):
        if os.path.exists(SESSIONS_FILE):
            unique, total = load_and_deduplicate_sessions(SESSIONS_FILE)
            self.assertEqual(total, 680)
            self.assertEqual(len(unique), 401)


if __name__ == "__main__":
    unittest.main()
