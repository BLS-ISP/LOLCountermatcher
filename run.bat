@echo off
title LoL Countermatcher & Build Companion
echo =======================================================
echo          LoL Countermatcher & Build Companion
echo =======================================================
echo.
echo Starting FastAPI Web Server...
echo The companion dashboard will open automatically in your browser.
echo Keep this terminal window open while playing!
echo.
python main.py
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Failed to start. Make sure Python is in your PATH and dependencies are installed.
    pause
)
