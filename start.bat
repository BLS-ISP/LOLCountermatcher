@echo off
title LoL Countermatcher - Start
echo =======================================================
echo          LoL Countermatcher ^& Build Companion
echo =======================================================
echo.

:: 1. Terminate any currently running instance to prevent port conflicts
echo Stopping any running instances...
taskkill /f /im lol_countermatcher.exe >nul 2>&1

:: 2. Compile release binary to rebuild automatically if source files changed
echo [INFO] Running Cargo compilation...
cargo build --release
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Cargo build failed. Please resolve compile issues.
    pause
    exit /b %ERRORLEVEL%
)

:: 3. Copy to root directory for distribution convenience
copy /y "target\release\lol_countermatcher.exe" "lol_countermatcher.exe" >nul

:: 4. Start the server
echo.
echo Starting native companion web server...
echo The companion dashboard will open automatically in your browser.
echo Keep this terminal window open while playing!
echo.
lol_countermatcher.exe
