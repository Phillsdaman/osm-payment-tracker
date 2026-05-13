"""Online Scout Manager client (parent-portal API).

Cookie-session mode for use while waiting for official OAuth access.
Designed so that swapping to OAuth later only changes the auth class.

Discovered endpoints (parent portal — what you see when logged in as a parent):
    GET  /ext/mymember/payments/?action=getDetails&section_id=X&member_id=Y
    GET  /ext/mymember/payments/?action=getSchedule&section_id=X&member_id=Y&schedule_id=Z
    GET  /ext/mymember/events/?action=getDetails&section_id=X&member_id=Y
    GET  /ext/mymember/?action=track
    GET  /ext/users/auth/?action=ping&user_id=X

Each request needs cookies copied from a logged-in browser session.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

import requests

log = logging.getLogger(__name__)

BASE = "https://www.onlinescoutmanager.co.uk"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


class OSMAuthError(Exception):
    """Raised when OSM rejects our credentials (expired session etc.)."""


class OSMRequestError(Exception):
    """Raised on non-2xx HTTP response from OSM."""


# ───────── Auth strategies ─────────

@dataclass
class OSMCookieAuth:
    """Browser-session authentication.

    Two ways to populate this:
      1) cookie_header: paste the entire 'Cookie:' request header from
         DevTools → Network → any OSM request. Recommended — works regardless
         of which cookies OSM uses on a given day.
      2) phpsessid + extra_cookies: legacy individual cookie names.
    """
    cookie_header: str | None = None
    phpsessid: str | None = None
    extra_cookies: dict[str, str] = field(default_factory=dict)

    def _parsed_cookies(self) -> dict[str, str]:
        cookies: dict[str, str] = {}
        if self.cookie_header:
            for chunk in self.cookie_header.split(";"):
                if "=" not in chunk:
                    continue
                k, v = chunk.split("=", 1)
                k = k.strip()
                v = v.strip()
                if k:
                    cookies[k] = v
        if self.phpsessid:
            cookies.setdefault("PHPSESSID", self.phpsessid)
        for k, v in self.extra_cookies.items():
            cookies[k] = v
        return cookies

    def apply(self, session: requests.Session) -> None:
        for k, v in self._parsed_cookies().items():
            session.cookies.set(k, v, domain="www.onlinescoutmanager.co.uk")


@dataclass
class OSMOAuthAuth:
    """Placeholder for the official OAuth flow we'll switch to once granted."""
    access_token: str

    def apply(self, session: requests.Session) -> None:
        session.headers["Authorization"] = f"Bearer {self.access_token}"


# ───────── Client ─────────

class OSMClient:
    """Thin wrapper around OSM's parent-portal endpoints."""

    def __init__(self, auth: OSMCookieAuth | OSMOAuthAuth, *, timeout: float = 20.0):
        self.auth = auth
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": USER_AGENT,
                "X-Requested-With": "XMLHttpRequest",
                "Origin": BASE,
                "Referer": BASE + "/",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "en-GB,en;q=0.9",
            }
        )
        self.auth.apply(self.session)

    # ───── core HTTP ─────

    def _get(self, path: str, params: dict[str, Any]) -> Any:
        url = f"{BASE}{path}"
        log.debug("GET %s params=%s", url, params)
        resp = self.session.get(url, params=params, timeout=self.timeout)
        if resp.status_code in (401, 403):
            raise OSMAuthError(
                f"OSM rejected the request ({resp.status_code}). Session likely expired — "
                "re-grab the Cookie header from your browser and update Settings."
            )
        # OSM returns 404 with an HTML page for wrong endpoints
        ct = resp.headers.get("Content-Type", "")
        if "text/html" in ct:
            raise OSMRequestError(
                f"OSM returned HTML (status {resp.status_code}) — endpoint may be wrong "
                "or your session was redirected to login. URL: {url}"
            )
        if resp.status_code >= 400:
            raise OSMRequestError(f"OSM HTTP {resp.status_code}: {resp.text[:300]}")
        text = resp.text.strip()
        if text in ("false", "", "null"):
            raise OSMAuthError("OSM returned empty/false — session almost certainly expired.")
        try:
            return resp.json()
        except ValueError as e:
            raise OSMRequestError(f"OSM returned non-JSON: {text[:300]}") from e

    # ───── endpoints ─────

    def get_member_payments(self, section_id: str | int, member_id: str | int) -> Any:
        """GET /ext/mymember/payments/?action=getDetails

        Returns the list of payment schedules a member is on (parent-portal view).
        Each entry typically has a schedule_id we can drill into with
        get_payment_schedule().
        """
        return self._get(
            "/ext/mymember/payments/",
            {"action": "getDetails", "section_id": section_id, "member_id": member_id},
        )

    def get_payment_schedule(
        self,
        section_id: str | int,
        member_id: str | int,
        schedule_id: str | int,
    ) -> Any:
        """GET /ext/mymember/payments/?action=getSchedule

        Drills into one specific payment schedule for line-item detail:
        instalments, amounts, due dates, paid status.
        """
        return self._get(
            "/ext/mymember/payments/",
            {
                "action": "getSchedule",
                "section_id": section_id,
                "member_id": member_id,
                "schedule_id": schedule_id,
            },
        )

    def get_member_events(self, section_id: str | int, member_id: str | int) -> Any:
        """GET /ext/mymember/events/?action=getDetails

        Returns events/camps the member is signed up for.
        """
        return self._get(
            "/ext/mymember/events/",
            {"action": "getDetails", "section_id": section_id, "member_id": member_id},
        )

    def ping(self, user_id: str | int | None = None) -> Any:
        """Cheap liveness check for cookie validity."""
        params = {"action": "ping"}
        if user_id is not None:
            params["user_id"] = user_id
        return self._get("/ext/users/auth/", params)


# ───────── Sync orchestration ─────────

def fetch_for_members(
    client: OSMClient,
    members: list[dict],
) -> dict[str, dict]:
    """For each member with osm_section_id + osm_member_id set, fetch payments
    (with per-scheme drill-down) and events.

    Returns dict keyed by local member id. Each value has:
      - member_name, section_id, member_id (echo)
      - events: { status, data: [event...] }      — list of camps/events
      - payments: { status, data: { payments: [scheme...] } }  — scheme headers
      - schedules: { scheme_id: { ...details... } }            — drill-down per scheme

    Errors per-member or per-scheme are caught and surfaced in the output so
    one bad call doesn't blow up the whole sync.
    """
    out: dict[str, dict] = {}
    for m in members:
        sid = m.get("osm_section_id")
        mid = m.get("osm_member_id")
        if not sid or not mid:
            continue
        entry: dict[str, Any] = {
            "member_name": m.get("name"),
            "section_id": sid,
            "member_id": mid,
        }
        # Events
        try:
            entry["events"] = client.get_member_events(sid, mid)
        except (OSMAuthError, OSMRequestError) as e:
            entry["events_error"] = str(e)
        # Payment schemes (headers)
        try:
            payments_response = client.get_member_payments(sid, mid)
            entry["payments"] = payments_response
            # Drill into each scheme
            schemes = []
            if isinstance(payments_response, dict):
                data = payments_response.get("data") or {}
                if isinstance(data, dict):
                    schemes = data.get("payments") or []
            entry["schedules"] = {}
            for scheme in schemes:
                if not isinstance(scheme, dict):
                    continue
                scheme_id = scheme.get("scheme_id") or scheme.get("schedule_id")
                if not scheme_id:
                    continue
                try:
                    entry["schedules"][str(scheme_id)] = client.get_payment_schedule(sid, mid, scheme_id)
                except (OSMAuthError, OSMRequestError) as e:
                    entry["schedules"][str(scheme_id)] = {"error": str(e)}
        except (OSMAuthError, OSMRequestError) as e:
            entry["payments_error"] = str(e)
        out[m["id"]] = entry
    return out


# ───────── Event parsing helpers ─────────

def parse_event_extra(extra: Any) -> dict:
    """The 'extra' field on events is a JSON string with nested config.
    Returns the parsed dict or {} on any failure."""
    if not extra or not isinstance(extra, str):
        return {}
    try:
        return json.loads(extra)
    except (ValueError, TypeError):
        return {}


def normalize_event(raw: dict) -> dict:
    """Flatten an OSM event into the shape db.upsert_activity_from_osm expects.

    Pulls location out of the nested 'extra.sharing.template.location' field.
    Cost prefers numeric cost_raw if positive, else None (TBC).
    """
    extra = parse_event_extra(raw.get("extra"))
    template = (extra.get("sharing") or {}).get("template") or {}
    location = template.get("location")
    cost_raw = raw.get("cost_raw")
    cost = None
    if isinstance(cost_raw, (int, float)) and cost_raw > 0:
        cost = float(cost_raw)
    return {
        "event_id": raw.get("event_id"),
        "name": raw.get("name"),
        "startdate": raw.get("startdate"),
        "enddate": raw.get("enddate") or raw.get("startdate"),
        "location": location,
        "cost": cost,
    }
