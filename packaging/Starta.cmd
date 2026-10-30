@echo off
chcp 65001 >nul
cd /d "%~dp0"
".runtime\node.exe" "scripts\launch.mjs"
if errorlevel 1 pause
