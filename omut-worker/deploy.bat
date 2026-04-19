@echo off
cd /d "%~dp0"
title Omut Worker deploy
echo.
echo ============================================================
echo   Omut Worker - deploy to Cloudflare
echo ============================================================
echo.
echo Current folder:
echo   %CD%
echo.

echo [1/3] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js is NOT installed.
    echo.
    echo Please install Node.js LTS:
    echo   1. Open https://nodejs.org
    echo   2. Click the big green "LTS" button
    echo   3. Run the downloaded .msi, Next / Next / Install
    echo   4. Close this window and double-click deploy.bat again
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%i in ('node --version') do set NODEV=%%i
echo       OK Node.js %NODEV%
echo.

echo [2/3] Checking wrangler...
where npx >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npx not found. Reinstall Node.js.
    pause
    exit /b 1
)
echo       OK npx found
echo.

echo [3/3] Running: npx --yes wrangler deploy
echo.
echo     If it asks "Need to install wrangler... OK?" - type  y  and Enter.
echo     If it asks to login - your browser will open, click Allow.
echo.
echo ------------------------------------------------------------

call npx --yes wrangler deploy
set EXITCODE=%errorlevel%

echo ------------------------------------------------------------
echo.
if %EXITCODE% EQU 0 (
    echo [OK] Deploy finished. Look above for the line:
    echo      https://omut-worker.xxxxx.workers.dev
    echo      Copy it and send to Claude.
) else (
    echo [FAILED] Exit code: %EXITCODE%
    echo Copy the full output above and send to Claude.
)
echo.
pause
