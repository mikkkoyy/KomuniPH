@echo off
setlocal EnableExtensions EnableDelayedExpansion
title KomuniPH Lite

cd /d "%~dp0"

echo ==========================================
echo          KOMUNIPH LITE SERVER
echo ==========================================
echo.
echo Project: %CD%
echo GitHub:  https://github.com/mikkkoyy/KomuniPH
echo.

set "KOMUNIPH_DIR=%CD%"
set "SERVER_PID="

REM ==========================================================
REM CHECK GIT
REM ==========================================================

where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git is not installed or not available in PATH.
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

git branch -M main

REM ==========================================================
REM GITHUB BACKUP
REM ==========================================================

echo.
echo ==========================================
echo          GITHUB SYNC
echo ==========================================
echo.

git status --short
echo.

echo [GIT] Adding changed files...
git add .
if errorlevel 1 (
    echo [ERROR] Git add failed.
    pause
    exit /b 1
)

git diff --cached --quiet
if errorlevel 1 (
    echo [GIT] Changes detected.
    echo [GIT] Creating backup commit...

    git commit -m "Auto backup - %date% %time%"
    if errorlevel 1 (
        echo.
        echo [ERROR] Git commit failed.
        echo.
        pause
        exit /b 1
    )
) else (
    echo [GIT] No new changes to commit.
)

echo.
echo [GIT] Uploading KomuniPH to GitHub...
echo.

git push -u origin main
if errorlevel 1 (
    echo.
    echo ==========================================
    echo [WARNING] GitHub upload failed
    echo ==========================================
    echo.
    echo Local project is still intact.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo       GITHUB BACKUP COMPLETE
echo ==========================================
echo.

REM ==========================================================
REM FIND EXISTING KOMUNIPH SERVER
REM ==========================================================

echo [CHECK] Looking for existing KomuniPH server...

set "EXISTING_PID="

if exist "%KOMUNIPH_DIR%\find_komuniph.ps1" (
    for /f "tokens=*" %%a in ('
        powershell -NoProfile -ExecutionPolicy Bypass -File "%KOMUNIPH_DIR%\find_komuniph.ps1" 2^>nul
    ') do (
        set "EXISTING_PID=%%a"
    )
)

if defined EXISTING_PID (
    echo [INFO] KomuniPH is already running.
    echo [INFO] Existing PID: %EXISTING_PID%
    set "SERVER_PID=%EXISTING_PID%"
    goto VERIFY_HEALTH
)

echo [OK] No existing KomuniPH server found.

REM ==========================================================
REM CHECK PORT 3000
REM ==========================================================

echo.
echo [CHECK] Verifying port 3000 availability...

set "PORT_PID="

for /f "tokens=5" %%a in ('
    netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"
') do (
    set "PORT_PID=%%a"
)

if defined PORT_PID (
    echo [WARN] Port 3000 is already occupied.
    echo [INFO] PID: %PORT_PID%

    set "PORT_IS_KOMUNIPH="

    if exist "%KOMUNIPH_DIR%\check_port_pid.ps1" (
        for /f "tokens=*" %%p in ('
            powershell -NoProfile -ExecutionPolicy Bypass -File "%KOMUNIPH_DIR%\check_port_pid.ps1" %PORT_PID% 2^>nul
        ') do (
            set "PORT_IS_KOMUNIPH=%%p"
        )
    )

    if defined PORT_IS_KOMUNIPH (
        echo [INFO] Existing KomuniPH process detected.
        echo [ACTION] Stopping old server...

        taskkill /PID %PORT_PID% /F >nul 2>&1
        timeout /t 1 /nobreak >nul

        echo [OK] Previous KomuniPH server stopped.
    ) else (
        echo.
        echo [ERROR] Port 3000 is occupied by another application.
        echo [ERROR] PID: %PORT_PID%
        echo.
        pause
        exit /b 1
    )
)

REM ==========================================================
REM AUTO START SERVER
REM ==========================================================

echo.
echo ==========================================
echo       AUTO STARTING KOMUNIPH
echo ==========================================
echo.

if not exist "%KOMUNIPH_DIR%\start_server.ps1" (
    echo [ERROR] start_server.ps1 was not found.
    echo.
    pause
    exit /b 1
)

echo [ACTION] Starting server...

for /f "tokens=*" %%a in ('
    powershell -NoProfile -ExecutionPolicy Bypass -File "%KOMUNIPH_DIR%\start_server.ps1" 2^>nul
') do (
    set "SERVER_PID=%%a"
)

if not defined SERVER_PID (
    echo.
    echo [ERROR] Failed to start KomuniPH server.
    echo.
    pause
    exit /b 1
)

echo [INFO] Server PID: %SERVER_PID%

REM ==========================================================
REM VERIFY SERVER HEALTH
REM ==========================================================

:VERIFY_HEALTH

echo.
echo [CHECK] Waiting for KomuniPH to become responsive...

set "MAX_WAIT=15"
set "WAITED=0"

:WAIT_LOOP

timeout /t 1 /nobreak >nul
set /a WAITED+=1

curl -s -o nul -w "%%{http_code}" http://localhost:3000/api/health 2>nul | findstr "200" >nul

if not errorlevel 1 (
    echo.
    echo ==========================================
    echo [SUCCESS] KOMUNIPH IS RUNNING
    echo ==========================================
    echo.
    echo Server: http://localhost:3000
    echo API:    http://localhost:3000/api/health
    echo PID:    %SERVER_PID%
    echo.
    echo KomuniPH launched automatically.
    echo.
    goto RUNNING
)

if %WAITED% geq %MAX_WAIT% (
    echo.
    echo ==========================================
    echo [ERROR] KOMUNIPH FAILED TO START
    echo ==========================================
    echo.
    echo Server did not become healthy within %MAX_WAIT% seconds.

    if defined SERVER_PID (
        taskkill /PID %SERVER_PID% /F >nul 2>&1
    )

    echo.
    echo Server process cleaned up.
    pause
    exit /b 1
)

goto WAIT_LOOP

REM ==========================================================
REM SERVER RUNNING
REM ==========================================================

:RUNNING

echo ==========================================
echo       KOMUNIPH READY
echo ==========================================
echo.
echo Open:
echo http://localhost:3000
echo.
echo Press L to shut down KomuniPH.
echo.

:MENU_LOOP

choice /c L /n /m "Press L to shutdown: "

if errorlevel 1 goto SHUTDOWN

goto MENU_LOOP

REM ==========================================================
REM SHUTDOWN
REM ==========================================================

:SHUTDOWN

echo.
echo ==========================================
echo       SHUTTING DOWN KOMUNIPH
echo ==========================================
echo.

if defined SERVER_PID (
    echo [ACTION] Stopping KomuniPH server PID %SERVER_PID%...

    taskkill /PID %SERVER_PID% /F >nul 2>&1

    timeout /t 1 /nobreak >nul

    netstat -ano | findstr ":3000" | findstr "LISTENING" >nul 2>&1

    if errorlevel 1 (
        echo [OK] Port 3000 released.
    ) else (
        echo [WARN] Port 3000 is still in use.
        echo [INFO] No unrelated process will be terminated.
    )
) else (
    echo [WARN] No KomuniPH PID was recorded.
)

echo.
echo ==========================================
echo       KOMUNIPH STOPPED
echo ==========================================
echo.

exit /b 0
