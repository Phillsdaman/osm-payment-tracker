"""Tiny HTTP API server using only the Python standard library.

Routes:
    GET    /api/members
    POST   /api/members            { ...member }
    DELETE /api/members/{id}

    GET    /api/activities
    POST   /api/activities         { ...activity, attendee_ids: [...], auto_create_payments: bool }
    DELETE /api/activities/{id}

    GET    /api/payments
    POST   /api/payments           { ...payment }
    DELETE /api/payments/{id}

    GET    /api/export
    POST   /api/import             { members: [...], activities: [...], payments: [...] }

    GET    /api/settings/{key}
    PUT    /api/settings/{key}     { value: ... }

    POST   /api/osm/sync           { section_ids: [int], name_filter: [str] }

Static files served from ./web/.
"""
from __future__ import annotations

import json
import logging
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import db
import osm

log = logging.getLogger(__name__)
WEB_DIR = Path(__file__).parent / "web"
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload):
    body = json.dumps(payload, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


def _read_json(handler: BaseHTTPRequestHandler) -> dict:
    length = int(handler.headers.get("Content-Length", "0"))
    if not length:
        return {}
    raw = handler.rfile.read(length)
    return json.loads(raw.decode("utf-8") or "{}")


class Handler(BaseHTTPRequestHandler):
    # Quieten the default access log a bit
    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        log.debug("%s - %s", self.address_string(), fmt % args)

    # ─── routing ───
    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self._dispatch_api("GET", path)
        return self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self._dispatch_api("POST", path)
        self.send_error(404)

    def do_PUT(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self._dispatch_api("PUT", path)
        self.send_error(404)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self._dispatch_api("DELETE", path)
        self.send_error(404)

    # ─── static ───
    def _serve_static(self, path: str):
        if path == "/" or path == "":
            path = "/index.html"
        target = (WEB_DIR / path.lstrip("/")).resolve()
        try:
            target.relative_to(WEB_DIR.resolve())
        except ValueError:
            return self.send_error(403)
        if not target.is_file():
            return self.send_error(404)
        ctype = MIME.get(target.suffix, "application/octet-stream")
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ─── api ───
    def _dispatch_api(self, method: str, path: str):
        try:
            return self._route(method, path)
        except Exception as e:
            log.exception("API error")
            return _json_response(self, 500, {"error": str(e)})

    def _route(self, method: str, path: str):
        # /api/members
        if path == "/api/members" and method == "GET":
            return _json_response(self, 200, db.list_members())
        if path == "/api/members" and method == "POST":
            return _json_response(self, 200, db.upsert_member(_read_json(self)))
        m = re.match(r"^/api/members/([^/]+)$", path)
        if m and method == "DELETE":
            db.delete_member(m.group(1))
            return _json_response(self, 200, {"ok": True})

        # /api/activities
        if path == "/api/activities" and method == "GET":
            return _json_response(self, 200, db.list_activities())
        if path == "/api/activities" and method == "POST":
            return _json_response(self, 200, db.upsert_activity(_read_json(self)))
        m = re.match(r"^/api/activities/([^/]+)$", path)
        if m and method == "DELETE":
            db.delete_activity(m.group(1))
            return _json_response(self, 200, {"ok": True})

        # /api/payments
        if path == "/api/payments" and method == "GET":
            return _json_response(self, 200, db.list_payments())
        if path == "/api/payments" and method == "POST":
            return _json_response(self, 200, db.upsert_payment(_read_json(self)))
        m = re.match(r"^/api/payments/([^/]+)$", path)
        if m and method == "DELETE":
            db.delete_payment(m.group(1))
            return _json_response(self, 200, {"ok": True})

        # /api/export & /api/import
        if path == "/api/export" and method == "GET":
            return _json_response(self, 200, db.export_all())
        if path == "/api/import" and method == "POST":
            data = _read_json(self)
            n = {"members": 0, "activities": 0, "payments": 0}
            for m_ in data.get("members", []):
                m_.pop("id", None)
                db.upsert_member(m_)
                n["members"] += 1
            for a in data.get("activities", []):
                a.pop("id", None)
                db.upsert_activity(a)
                n["activities"] += 1
            for p in data.get("payments", []):
                p.pop("id", None)
                db.upsert_payment(p)
                n["payments"] += 1
            return _json_response(self, 200, {"ok": True, "imported": n})

        # /api/settings/{key}
        m = re.match(r"^/api/settings/([^/]+)$", path)
        if m and method == "GET":
            return _json_response(self, 200, {"value": db.get_setting(m.group(1))})
        if m and method == "PUT":
            body = _read_json(self)
            db.set_setting(m.group(1), body.get("value"))
            return _json_response(self, 200, {"ok": True})

        # /api/osm/sync
        if path == "/api/osm/sync" and method == "POST":
            body = _read_json(self)
            cookie_header = (db.get_setting("osm_cookie_header") or "").strip()
            phpsessid = (db.get_setting("osm_phpsessid") or "").strip()
            extra_raw = db.get_setting("osm_extra_cookies") or {}
            if not (cookie_header or phpsessid):
                return _json_response(self, 400, {"error": "No OSM cookies saved. Set them in Settings first."})
            try:
                client = osm.OSMClient(osm.OSMCookieAuth(
                    cookie_header=cookie_header or None,
                    phpsessid=phpsessid or None,
                    extra_cookies=extra_raw,
                ))
                rows = osm.build_master_schedule(
                    client,
                    section_ids=body.get("section_ids") or [],
                    name_filter=body.get("name_filter") or None,
                )
            except osm.OSMAuthError as e:
                return _json_response(self, 401, {"error": str(e)})
            # TODO: upsert rows into db.payments using osm_id for dedupe.
            # For now we just return them so Philip can verify the auth flow.
            return _json_response(self, 200, {"ok": True, "rows": rows, "count": len(rows)})

        return self.send_error(404)


def serve(host: str = "127.0.0.1", port: int = 8765):
    db.init_db()
    server = ThreadingHTTPServer((host, port), Handler)
    log.info("OSM Tracker API listening on http://%s:%d", host, port)
    return server
