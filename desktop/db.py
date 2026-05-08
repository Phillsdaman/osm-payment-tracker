"""SQLite layer for OSM Payment Tracker.

Schema is intentionally simple. All tables have:
  - id (TEXT PK, uuid4)
  - created_at, updated_at (ISO 8601 strings)
  - source ('manual' | 'osm') so we can mark OSM-imported records
  - osm_id (nullable) — original ID from OSM for upsert/dedupe
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).parent / "tracker.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'child',          -- 'child' | 'leader'
    email TEXT,
    track_payments INTEGER NOT NULL DEFAULT 1,   -- 0 | 1
    osm_member_id TEXT,                           -- OSM scoutid, for sync
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    start_date TEXT,                              -- 'YYYY-MM-DD'
    end_date TEXT,
    location TEXT,
    cost REAL,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    osm_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_attendees (
    activity_id TEXT NOT NULL,
    member_id TEXT NOT NULL,
    PRIMARY KEY (activity_id, member_id),
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    activity_id TEXT,                             -- nullable for ad-hoc payments
    amount_due REAL NOT NULL DEFAULT 0,
    amount_paid REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'unpaid',        -- unpaid | partial | paid
    due_date TEXT,
    paid_date TEXT,
    paid_by TEXT,
    method TEXT,
    reference TEXT,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    osm_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_member ON payments(member_id);
CREATE INDEX IF NOT EXISTS idx_payments_activity ON payments(activity_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_activities_start ON activities(start_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_osm ON payments(osm_id) WHERE osm_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_osm ON activities(osm_id) WHERE osm_id IS NOT NULL;
"""


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex


@contextmanager
def connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with connect() as c:
        c.executescript(SCHEMA)
    seed_if_empty()


def seed_if_empty() -> None:
    """Seed Philip's family on first run."""
    with connect() as c:
        n = c.execute("SELECT COUNT(*) AS n FROM members").fetchone()["n"]
        if n > 0:
            return
        seed = [
            ("Philip Owens", "leader", "philip.owens@hotmail.co.uk", 0),
            ("Jade Owens", "leader", "j.jade.owens@gmail.com", 0),
            ("Leo Owens", "child", None, 1),
            ("Max Owens", "child", None, 1),
            ("Lisa Clarke", "child", None, 1),
            ("Aaron Clarke", "child", None, 0),
        ]
        ts = now_iso()
        for name, role, email, track in seed:
            c.execute(
                "INSERT INTO members (id,name,role,email,track_payments,created_at,updated_at) "
                "VALUES (?,?,?,?,?,?,?)",
                (new_id(), name, role, email, track, ts, ts),
            )


def row_to_dict(r: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(r) if r else None


# ───────── Members ─────────

def list_members() -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT * FROM members ORDER BY name").fetchall()
        return [dict(r) for r in rows]


def upsert_member(data: dict) -> dict:
    ts = now_iso()
    with connect() as c:
        if data.get("id"):
            c.execute(
                "UPDATE members SET name=?, role=?, email=?, track_payments=?, notes=?, updated_at=? WHERE id=?",
                (
                    data["name"],
                    data.get("role", "child"),
                    data.get("email"),
                    1 if data.get("track_payments") else 0,
                    data.get("notes"),
                    ts,
                    data["id"],
                ),
            )
            mid = data["id"]
        else:
            mid = new_id()
            c.execute(
                "INSERT INTO members (id,name,role,email,track_payments,notes,created_at,updated_at) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (
                    mid,
                    data["name"],
                    data.get("role", "child"),
                    data.get("email"),
                    1 if data.get("track_payments") else 0,
                    data.get("notes"),
                    ts,
                    ts,
                ),
            )
        return row_to_dict(c.execute("SELECT * FROM members WHERE id=?", (mid,)).fetchone())


def delete_member(mid: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM members WHERE id=?", (mid,))


# ───────── Activities ─────────

def list_activities() -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT * FROM activities ORDER BY start_date NULLS LAST").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            attendees = c.execute(
                "SELECT member_id FROM activity_attendees WHERE activity_id=?",
                (d["id"],),
            ).fetchall()
            d["attendee_ids"] = [a["member_id"] for a in attendees]
            result.append(d)
        return result


def upsert_activity(data: dict) -> dict:
    ts = now_iso()
    with connect() as c:
        if data.get("id"):
            c.execute(
                "UPDATE activities SET name=?, start_date=?, end_date=?, location=?, cost=?, notes=?, updated_at=? "
                "WHERE id=?",
                (
                    data["name"],
                    data.get("start_date"),
                    data.get("end_date"),
                    data.get("location"),
                    data.get("cost"),
                    data.get("notes"),
                    ts,
                    data["id"],
                ),
            )
            aid = data["id"]
        else:
            aid = new_id()
            c.execute(
                "INSERT INTO activities (id,name,start_date,end_date,location,cost,notes,source,created_at,updated_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    aid,
                    data["name"],
                    data.get("start_date"),
                    data.get("end_date"),
                    data.get("location"),
                    data.get("cost"),
                    data.get("notes"),
                    data.get("source", "manual"),
                    ts,
                    ts,
                ),
            )
        # Replace attendees
        c.execute("DELETE FROM activity_attendees WHERE activity_id=?", (aid,))
        for mid in data.get("attendee_ids", []):
            c.execute(
                "INSERT INTO activity_attendees (activity_id,member_id) VALUES (?,?)",
                (aid, mid),
            )
        # Auto-create payments for paying attendees if requested
        if data.get("auto_create_payments") and data.get("cost"):
            existing = {
                r["member_id"]
                for r in c.execute(
                    "SELECT member_id FROM payments WHERE activity_id=?", (aid,)
                ).fetchall()
            }
            paying_attendees = c.execute(
                "SELECT m.id FROM members m WHERE m.track_payments=1 AND m.id IN "
                "(SELECT member_id FROM activity_attendees WHERE activity_id=?)",
                (aid,),
            ).fetchall()
            for r in paying_attendees:
                if r["id"] in existing:
                    continue
                c.execute(
                    "INSERT INTO payments (id,member_id,activity_id,amount_due,amount_paid,status,due_date,created_at,updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?)",
                    (
                        new_id(),
                        r["id"],
                        aid,
                        data["cost"],
                        0,
                        "unpaid",
                        data.get("start_date"),
                        ts,
                        ts,
                    ),
                )
        return list_one_activity(aid, c)


def list_one_activity(aid: str, c: sqlite3.Connection) -> dict:
    r = c.execute("SELECT * FROM activities WHERE id=?", (aid,)).fetchone()
    if not r:
        return None
    d = dict(r)
    d["attendee_ids"] = [
        a["member_id"]
        for a in c.execute(
            "SELECT member_id FROM activity_attendees WHERE activity_id=?", (aid,)
        ).fetchall()
    ]
    return d


def delete_activity(aid: str, cascade_payments: bool = True) -> None:
    with connect() as c:
        if cascade_payments:
            c.execute("DELETE FROM payments WHERE activity_id=?", (aid,))
        c.execute("DELETE FROM activities WHERE id=?", (aid,))


# ───────── Payments ─────────

def list_payments() -> list[dict]:
    with connect() as c:
        rows = c.execute("SELECT * FROM payments ORDER BY due_date NULLS LAST").fetchall()
        return [dict(r) for r in rows]


def _compute_status(due: float, paid: float) -> str:
    due = float(due or 0)
    paid = float(paid or 0)
    if paid <= 0:
        return "unpaid"
    if paid >= due:
        return "paid"
    return "partial"


def upsert_payment(data: dict) -> dict:
    ts = now_iso()
    status = _compute_status(data.get("amount_due", 0), data.get("amount_paid", 0))
    with connect() as c:
        if data.get("id"):
            c.execute(
                "UPDATE payments SET member_id=?, activity_id=?, amount_due=?, amount_paid=?, status=?, "
                "due_date=?, paid_date=?, paid_by=?, method=?, reference=?, notes=?, updated_at=? WHERE id=?",
                (
                    data["member_id"],
                    data.get("activity_id"),
                    data.get("amount_due", 0),
                    data.get("amount_paid", 0),
                    status,
                    data.get("due_date"),
                    data.get("paid_date"),
                    data.get("paid_by"),
                    data.get("method"),
                    data.get("reference"),
                    data.get("notes"),
                    ts,
                    data["id"],
                ),
            )
            pid = data["id"]
        else:
            pid = new_id()
            c.execute(
                "INSERT INTO payments (id,member_id,activity_id,amount_due,amount_paid,status,due_date,paid_date,"
                "paid_by,method,reference,notes,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    pid,
                    data["member_id"],
                    data.get("activity_id"),
                    data.get("amount_due", 0),
                    data.get("amount_paid", 0),
                    status,
                    data.get("due_date"),
                    data.get("paid_date"),
                    data.get("paid_by"),
                    data.get("method"),
                    data.get("reference"),
                    data.get("notes"),
                    data.get("source", "manual"),
                    ts,
                    ts,
                ),
            )
        return row_to_dict(c.execute("SELECT * FROM payments WHERE id=?", (pid,)).fetchone())


def delete_payment(pid: str) -> None:
    with connect() as c:
        c.execute("DELETE FROM payments WHERE id=?", (pid,))


# ───────── Settings ─────────

def get_setting(key: str, default: Any = None) -> Any:
    with connect() as c:
        r = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        if not r:
            return default
        try:
            return json.loads(r["value"])
        except Exception:
            return r["value"]


def set_setting(key: str, value: Any) -> None:
    with connect() as c:
        v = json.dumps(value) if not isinstance(value, str) else value
        c.execute(
            "INSERT INTO settings (key,value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, v),
        )


# ───────── Bulk export/import ─────────

def export_all() -> dict:
    return {
        "exported_at": now_iso(),
        "members": list_members(),
        "activities": list_activities(),
        "payments": list_payments(),
    }
