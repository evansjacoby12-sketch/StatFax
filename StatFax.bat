@echo off
setlocal enabledelayedexpansion
title StatFax - HR Model Board (always-on)
cd /d "%~dp0"

echo ============================================
echo   StatFax - HR Model Board
echo   build UI once, then serve + auto-refresh
echo ============================================
echo.

REM --- Node check ---------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [x] Node.js 20+ was not found on your PATH.
  echo     Install it from https://nodejs.org then run this again.
  echo.
  pause
  exit /b 1
)

REM --- Brain deps (esbuild, for the pipeline) -----------------------------
if not exist "node_modules" (
  echo [*] Installing brain dependencies ^(first run only^)...
  call npm install
  if errorlevel 1 ( echo [x] npm install failed. & pause & exit /b 1 )
)

REM --- UI deps + build ----------------------------------------------------
if not exist "ui\node_modules" (
  echo [*] Installing UI dependencies ^(first run only^)...
  call npm --prefix ui install
  if errorlevel 1 ( echo [x] UI npm install failed. & pause & exit /b 1 )
)
echo [*] Building the UI...
call npm --prefix ui run build
if errorlevel 1 ( echo [x] UI build failed. & pause & exit /b 1 )

REM --- Serve (auto-refreshes the slate every 20 min) ----------------------
echo.
echo [*] Starting StatFax at http://localhost:5180
echo     The slate refreshes automatically ^(no manual npm run slate^).
echo     Point ngrok at port 5180 for phone access.
echo     Keep this window open. Press Ctrl+C to stop.
echo.
call npm run serve

endlocal
