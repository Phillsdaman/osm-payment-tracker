"""Entry point — boots the local API server then opens Chrome in app-mode.

If Chrome isn't found we fall back to the default browser. Either way the
window points at http://127.0.0.1:8765 where the static UI is served.
"""
from __future__ import annotations

import logging
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import api

logging.basicConfig(
    level=os.environ.get("OSM_LOG", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("osm-tracker")

HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def find_free_port(start: int = DEFAULT_PORT) -> int:
    for p in range(start, start + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((HOST, p))
                return p
            except OSError:
                continue
    raise RuntimeError("No free port found")


def find_chrome() -> str | None:
    candidates = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
    ]
    for c in candidates:
        if c and Path(c).is_file():
            return c
    for name in ("chrome", "chrome.exe", "msedge", "msedge.exe"):
        found = shutil.which(name)
        if found:
            return found
    return None


def open_window(url: str):
    chrome = find_chrome()
    profile_dir = Path.home() / ".osm-tracker-profile"
    profile_dir.mkdir(exist_ok=True)
    if chrome:
        log.info("Launching app window via %s", chrome)
        subprocess.Popen(
            [
                chrome,
                f"--app={url}",
                f"--user-data-dir={profile_dir}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-features=TranslateUI",
                "--window-size=1200,800",
            ],
            close_fds=True,
        )
    else:
        log.warning("Chrome/Edge not found — opening in your default browser instead.")
        webbrowser.open(url)


def main():
    port = find_free_port()
    server = api.serve(host=HOST, port=port)
    url = f"http://{HOST}:{port}/"
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    # tiny delay so the window opens to a ready server
    time.sleep(0.4)
    open_window(url)
    print(f"\nOSM Tracker running at {url}")
    print("Close the app window or press Ctrl+C here to stop.\n")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Shutting down")
        server.shutdown()
        sys.exit(0)


if __name__ == "__main__":
    main()
