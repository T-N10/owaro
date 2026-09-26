@echo off
rem Open the app in demo mode from the desktop. Dev build only.
rem --demo gives it its own userData (like --gallery), so it runs as a
rem second instance even while the production tray app is up, and any
rem promise made here never touches the real state.json / records.json.
cd /d "%~dp0.."
call npx electron-vite dev -- --demo
