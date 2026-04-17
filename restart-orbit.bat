@echo off
echo Restarting Orbit...

taskkill /fi "WINDOWTITLE eq Orbit Backend" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Orbit Discord Bot" /f >nul 2>&1
timeout /t 2 /nobreak >nul

cd /d C:\Users\Alexander\KKBOT\backend
start "Orbit Backend" cmd /k "call venv\Scripts\activate.bat && uvicorn main:app --host 0.0.0.0 --port 8000 --reload"

start "Orbit Discord Bot" cmd /k "cd /d C:\Users\Alexander\KKBOT\discord-bot && node orbit_discord_bot.js"

echo Backend + Discord Bot restarted!
pause
