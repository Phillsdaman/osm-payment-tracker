@echo off
REM One-click launcher for OSM Payment Tracker.
REM Creates a venv on first run, installs requirements, then starts the app.

setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo.
        echo ERROR: Failed to create venv. Is Python on PATH? Try: python --version
        pause
        exit /b 1
    )
    .venv\Scripts\python.exe -m pip install --upgrade pip >nul
    .venv\Scripts\python.exe -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo ERROR: pip install failed.
        pause
        exit /b 1
    )
)

.venv\Scripts\python.exe app.py
