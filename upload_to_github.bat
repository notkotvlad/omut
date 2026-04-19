@echo off
title GitHub Upload

cd /d "%~dp0"

git status --short > nul 2>&1
git diff --quiet --exit-code > nul 2>&1
git diff --cached --quiet --exit-code > nul 2>&1

git status --porcelain > _tmp_check.txt
for %%A in (_tmp_check.txt) do set size=%%~zA
del _tmp_check.txt

if "%size%"=="0" (
    echo No changes to upload.
    echo.
    pause
    exit /b
)

echo Adding files...
git add .

echo Creating commit...
git commit -m "Update %date% %time:~0,5%"

echo.
echo Pushing to GitHub...
git push

echo.
if %errorlevel% == 0 (
    echo Done! Changes uploaded to GitHub.
) else (
    echo Something went wrong. See the message above.
)
echo.
pause
