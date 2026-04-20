@echo off
cd /d "%~dp0"
node collect-hydro.js >> collect-hydro.log 2>&1
