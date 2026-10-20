@echo off
cd /d "%~dp0"
git add -A
git commit -m "Quick sync %date% %time%"
git push origin main
pause
