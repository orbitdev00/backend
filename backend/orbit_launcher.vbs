Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd.exe /k cd /d C:\Users\Alexander\KKBOT\backend && python orbit_personal.py", 1, False
