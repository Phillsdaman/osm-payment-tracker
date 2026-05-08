# OSM Payment Tracker — Desktop

A local Windows app for tracking Online Scout Manager activity payments and attendance across one family. All data lives in a single SQLite file on your PC.

## Quick start

1. Make sure Python 3.10+ is installed and on PATH (`python --version` should work).
2. Double-click **`run.bat`**.
   - First run: creates a venv, installs dependencies, opens the app window.
   - Subsequent runs: starts immediately.
3. The app opens in a Chrome/Edge "app mode" window pointed at `http://127.0.0.1:8765`.

The Python process runs in the background terminal — close that window (or press Ctrl+C) to stop the app.

## Files

| | |
|---|---|
| `app.py` | Entry point — boots HTTP server + opens app window |
| `api.py` | Local REST API (Python stdlib only) |
| `db.py` | SQLite schema + CRUD |
| `osm.py` | Online Scout Manager client (cookie-session for now, OAuth-ready) |
| `web/` | HTML / JS / CSS UI served from the local server |
| `tracker.db` | Your data (created on first run, **back this up**) |

## OSM sync (temporary cookie auth)

While waiting for OSM developer OAuth approval, you can sync payment schedules using your browser session.

1. Sign into Online Scout Manager in Chrome.
2. F12 → **Application** tab → **Cookies** → `https://www.onlinescoutmanager.co.uk` → copy the **PHPSESSID** value.
3. In the app: **Settings** → paste PHPSESSID + your Section ID(s) → **Save**.
4. Click **Sync OSM** in the header.

Cookies expire after a few hours. When sync starts failing with "session expired", re-grab the cookie.

When OSM grants official API access, swap `OSMCookieAuth` for `OSMOAuthAuth` in `osm.py` — nothing else changes.

## Building a single .exe (optional)

```
.venv\Scripts\pip install pyinstaller
.venv\Scripts\pyinstaller --noconfirm --windowed --name "OSM Tracker" --add-data "web;web" app.py
```

Output lands in `dist\OSM Tracker\OSM Tracker.exe`.

## Backup

Just copy `tracker.db` somewhere safe — that's the entire database. Or use **Members → Export JSON** for a portable plaintext dump.
