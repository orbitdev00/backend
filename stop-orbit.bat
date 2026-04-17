@echo off
echo Stopping Orbit...

taskkill /fi "WINDOWTITLE eq Orbit Backend" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Orbit Frontend" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Orbit Ngrok" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Orbit Auto-Analyzer" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Orbit Discord Bot" /f >nul 2>&1

echo Orbit stopped.
pause
