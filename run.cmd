@echo off
REM Windows (cmd.exe) launcher (mirror of run.sh).
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
)

call npm run dev
