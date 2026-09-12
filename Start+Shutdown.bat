```bat
@echo off
setlocal EnableExtensions
title KomuniPH Lite

cd /d "%~dp0"

echo ==========================================
echo          KOMUNIPH LITE SERVER
echo ==========================================
echo.
echo Project: %CD%
echo GitHub:  https://github.com/mikkkoyy/KomuniPH
echo.

REM ==========================================================
REM CHECK GIT
REM ==========================================================

where git >nul 2>&1

if errorlevel 1 (
    echo [ERROR] Git is not installed or not available in PATH.
    echo.
    pause
    exit /b 1
)

REM ==========================================================
REM INITIALIZE GIT REPOSITORY IF NEEDED
REM ==========================================================

if not exist ".git" (
    echo [GIT] Initializing repository...
    git init

    if errorlevel 1 (
        echo [ERROR] Failed to initialize Git.
        pause
        exit /b 1
    )
)

REM ==========================================================
REM CONFIGURE REMOTE
REM ==========================================================

git remote get-url origin >nul 2>&1

if errorlevel 1 (
    echo [GIT] Adding GitHub remote...
    git remote add origin https://github.com/mikkkoyy/KomuniPH.git
) else (
    echo [GIT] GitHub remote already configured.
)

REM ==========================================================
REM ENSURE MAIN BRANCH
REM ==========================================================

git branch -M main

REM ==========================================================
REM SHOW CURRENT STATUS
REM ==========================================================

echo.
echo ==========================================
echo          GITHUB SYNC
echo ==========================================
echo.

git status --short

echo.

REM ==========================================================
REM ADD FILES
REM ==========================================================

echo [GIT] Adding changed files...

git add .

if errorlevel 1 (
    echo.
    echo [ERROR] Git add failed.
    pause
    exit /b 1
)

REM ==========================================================
REM COMMIT
REM ==========================================================

git diff --cached --quiet

if errorlevel 1 (
    echo [GIT] Changes detected.
    echo [GIT] Creating backup commit...

    git commit -m "Auto backup - %date% %time%"

    if errorlevel 1 (
        echo.
        echo [ERROR] Git commit failed.
        echo.
        echo The server will NOT start until the Git problem is fixed.
        pause
        exit /b 1
    )
) else (
    echo [GIT] No new changes to commit.
)

REM ==========================================================
REM PUSH TO GITHUB
REM ==========================================================

echo.
echo [GIT] Uploading KomuniPH to GitHub...
echo.

git push -u origin main

if errorlevel 1 (
    echo.
    echo ==========================================
    echo [WARNING] GitHub upload failed.
    echo ==========================================
    echo.
    echo KomuniPH will NOT be uploaded to GitHub.
    echo Check your GitHub authentication/credentials.
    echo.
    echo The local project is still intact.
    echo.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo       GITHUB BACKUP COMPLETE
echo ==========================================
echo.
echo Repository:
echo https://github.com/mikkkoyy/KomuniPH
echo.

REM ==========================================================
REM START SERVER
REM ==========================================================

echo Starting KomuniPH server...
echo.

start "KomuniPH Server" /b node server\index.js

timeout /t 2 /nobreak >nul

start "" "http://localhost:3000"

echo.
echo Server: http://localhost:3000
echo.
echo GitHub backup completed successfully.
echo.
echo Press L to shut down KomuniPH.
echo.

:MENU
choice /c L /n /m "Press L to shutdown: "

if errorlevel 1 goto SHUTDOWN

goto MENU

:SHUTDOWN
echo.
echo Shutting down KomuniPH...
echo.

taskkill /F /IM node.exe >nul 2>&1

echo.
echo KomuniPH stopped.
echo.

exit /b 0
```
