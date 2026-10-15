@echo off
setlocal
cd /d "%~dp0"

echo Starting the NammaWork local web server...
echo Open http://127.0.0.1:5500/fronted.html in your browser.
echo Keep this window open while using the app. Press Ctrl+C to stop.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"
if errorlevel 1 pause
