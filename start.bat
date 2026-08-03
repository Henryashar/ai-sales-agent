@echo off
setlocal

cd /d "C:\AIProjects\ai-sales-agent"

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

echo Starting AI Sales Agent at http://localhost:3000
echo Press Ctrl+C in this window to stop the server.
echo.
call npm run dev
