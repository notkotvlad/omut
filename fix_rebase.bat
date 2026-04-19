@echo off
title Fix - Abort Rebase

cd /d "%~dp0"

echo Aborting stuck rebase...
git rebase --abort

echo.
echo Restoring files...
git checkout HEAD -- .

echo.
echo Current files:
git status

echo.
echo Done. Your files should be back.
pause
