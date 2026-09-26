@echo off
rem Open the screen catalog (gallery) from the desktop. Dev build only.
rem Runs as a second, separate instance (own userData) so it never touches
rem the running owari-switch: no promise/state/records are read or written.
cd /d "%~dp0.."
call npx electron-vite dev -- --gallery
