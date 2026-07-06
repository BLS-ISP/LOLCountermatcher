@echo off
title LoL Countermatcher - Stop
echo =======================================================
echo          Stopping LoL Countermatcher Server
echo =======================================================
echo.

taskkill /f /im lol_countermatcher.exe >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [SUCCESS] LoL Countermatcher Server stopped.
) else (
    echo [INFO] No running instance of the server was found.
)
timeout /t 3 >nul
