"""Online Scout Manager client.

Cookie-session mode for use while waiting for official OAuth access.
Designed so that swapping to OAuth later only changes the auth class.

Usage:
    auth = OSMCookieAuth(phpsessid="...", extra_cookies={...})
    client = OSMClient(auth)
    schedules = client.get_payment_schedules(section_id=12345)

Reference: OSM uses an undocumented REST API:
    POST https://www.onlinescoutmanager.co.uk/ext/{module}/?action={action}
    Content-Type: application/x-www-form-urlencoded

NOTE: OSM blocks JSON request bodies. All POSTs must be form-encoded.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

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
      1) cookie_header: paste the entire 'Cookie:' request header string from
         DevTools → Network → any OSM request → Request Headers → Cookie.
         This is the recommended approach — works regardless of which cookies
         OSM is using on a given day.
      2) phpsessid + extra_cookies: legacy individual cookie names, kept for
         backwards compat.
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
    """Placeholder for the official OAuth flow we'll switch to once granted.

    When OSM approves the developer account, only this class needs filling in
    and OSMClient.__init__ stays the same.
    """
    access_token: str

    def apply(self, session: requests.Session) -> None:
        session.headers["Authorization"] = f"Bearer {self.access_token}"


# ───────── Client ─────────

class OSMClient:
    """Thin wrapper around OSM's undocumented REST endpoints.

    All POSTs are form-encoded — sending JSON gets the script blocked.
    """

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

    def _post(self, module: str, action: str, payload: dict[str, Any]) -> Any:
        url = f"{BASE}/ext/{module}/?action={action}"
        body = urlencode({k: ("" if v is None else v) for k, v in payload.items()})
        log.debug("POST %s body=%s", url, body[:200])
        resp = self.session.post(
            url,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=self.timeout,
        )
        if resp.status_code in (401, 403):
            raise OSMAuthError(
                f"OSM rejected the request ({resp.status_code}). Cookies likely expired — "
                "re-grab PHPSESSID from your browser and update the .env."
            )
        if resp.status_code >= 400:
            raise OSMRequestError(f"OSM HTTP {resp.status_code}: {resp.text[:300]}")
        # OSM sometimes returns "false" or HTML when session is invalid
        text = resp.text.strip()
        if text in ("false", "", "null"):
            raise OSMAuthError(
                "OSM returned an empty/false response — session almost certainly expired."
            )
        try:
            return resp.json()
        except ValueError as e:
            raise OSMRequestError(f"OSM returned non-JSON: {text[:300]}") from e

    # ───── endpoints ─────

    def get_payment_schedules(self, section_id: int, term_id: int | None = None) -> list[dict]:
        """ext/attendance/?action=getListOfGCPaymentSchedules

        Returns the list of payment schedules (subs, camp deposits, kit etc.)
        for the section. Typically returns a list of dicts; some OSM accounts
        wrap it as {"items": [...]}, so we normalise.
        """
        payload = {"sectionid": section_id}
        if term_id is not None:
            payload["termid"] = term_id
        result = self._post("attendance", "getListOfGCPaymentSchedules", payload)
        if isinstance(result, dict) and "items" in result:
            return result["items"]
        if isinstance(result, list):
            return result
        return []

    def get_payments(self, section_id: int, schedule_id: int | None = None, term_id: int | None = None) -> list[dict]:
        """ext/payments/?action=getPayments

        Returns individual payment line items. If a schedule_id is given,
        scopes the query to that schedule.
        """
        payload = {"sectionid": section_id}
        if schedule_id is not None:
            payload["scheduleid"] = schedule_id
        if term_id is not None:
            payload["termid"] = term_id
        result = self._post("payments", "getPayments", payload)
        if isinstance(result, dict) and "items" in result:
            return result["items"]
        if isinstance(result, list):
            return result
        return []

    def get_section_members(self, section_id: int, term_id: int | None = None) -> list[dict]:
        """ext/members/?action=getListOfMembers — handy for matching scoutid → name."""
        payload = {"sectionid": section_id}
        if term_id is not None:
            payload["termid"] = term_id
        result = self._post("members", "getListOfMembers", payload)
        if isinstance(result, dict) and "items" in result:
            return result["items"]
        if isinstance(result, list):
            return result
        return []


# ───────── Sync orchestration ─────────

def build_master_schedule(
    client: OSMClient,
    section_ids: list[int],
    name_filter: list[str] | None = None,
) -> list[dict]:
    """Fetch payment schedules + payments across one or more sections, merge into
    a single list sorted by due date.

    name_filter: case-insensitive substring match on member name.
                 e.g. ["leo", "max", "lisa"] limits to your kids.
    """
    nf = [n.lower() for n in (name_filter or [])]
    rows: list[dict] = []
    for sid in section_ids:
        try:
            schedules = client.get_payment_schedules(sid)
        except OSMAuthError:
            raise
        for sch in schedules:
            schedule_id = sch.get("scheduleid") or sch.get("id")
            try:
                payments = client.get_payments(sid, schedule_id=schedule_id)
            except OSMRequestError as e:
                log.warning("skipping schedule %s: %s", schedule_id, e)
                continue
            for p in payments:
                name = (p.get("firstname", "") + " " + p.get("lastname", "")).strip().lower()
                if nf and not any(n in name for n in nf):
                    continue
                rows.append(
                    {
                        "section_id": sid,
                        "schedule_id": schedule_id,
                        "schedule_name": sch.get("name") or sch.get("schedule_name"),
                        "member_name": (p.get("firstname", "") + " " + p.get("lastname", "")).strip(),
                        "scoutid": p.get("scoutid"),
                        "amount_due": float(p.get("amount") or p.get("amountdue") or 0),
                        "amount_paid": float(p.get("paid") or p.get("amountpaid") or 0),
                        "due_date": p.get("duedate") or sch.get("duedate"),
                        "status": p.get("status"),
                        "osm_payment_id": p.get("paymentid") or p.get("id"),
                        "raw": p,
                    }
                )
    rows.sort(key=lambda r: r.get("due_date") or "9999-99-99")
    return rows
