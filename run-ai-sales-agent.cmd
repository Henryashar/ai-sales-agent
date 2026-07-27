@echo off
setlocal

cd /d "%~dp0"

set "PORT=3000"
set "HOSTNAME=127.0.0.1"
set "LOCAL_DEFAULT_ACCESS_TOKEN="

echo.
echo AI Sales Agent local runner
echo ===========================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run this local app.
  echo Install Node.js LTS, then run this file again.
  echo.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist ".env.local" (
  echo Missing .env.local.
  echo Create it from .env.example and add your Notion, OpenAI, Google, and search API keys.
  echo.
  pause
  exit /b 1
)

findstr /R /C:"^AUTH_SESSION_SECRET=." ".env.local" >nul 2>nul
if errorlevel 1 (
  if not defined AUTH_SESSION_SECRET set "AUTH_SESSION_SECRET=ai-sales-agent-local-session-secret"
)

findstr /R /C:"^APP_ACCESS_TOKEN=." ".env.local" >nul 2>nul
if errorlevel 1 (
  findstr /R /C:"^APP_USERS_JSON=." ".env.local" >nul 2>nul
  if errorlevel 1 (
    if not defined APP_ACCESS_TOKEN (
      set "APP_ACCESS_TOKEN=local-only"
      set "LOCAL_DEFAULT_ACCESS_TOKEN=1"
    )
  )
)

if not exist "node_modules\next\package.json" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo.
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

echo Building the local production app...
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo Build failed. Check the error above.
  pause
  exit /b 1
)

echo.
echo Starting local app at http://%HOSTNAME%:%PORT%
if defined LOCAL_DEFAULT_ACCESS_TOKEN (
  echo Sign in with any name and email. Access code: local-only
) else (
  echo Sign in with your configured APP_ACCESS_TOKEN or APP_USERS_JSON code.
)
echo Keep this window open while using the app. Close it to stop the local backend.
echo.

start "" "http://%HOSTNAME%:%PORT%"
call npm.cmd run start -- -H %HOSTNAME% -p %PORT%

echo.
echo The local app has stopped.
pause
