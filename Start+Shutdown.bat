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
REM VERIFY SERVER HEALTH - SUBROUTINE
REM ==========================================================

:VERIFY_HEALTH
echo [CHECK] Waiting for server to become responsive...

set MAX_WAIT=15
set WAITED=0
:WAIT_LOOP
timeout /t 1 /nobreak >nul
set /a WAITED+=1

REM Try to connect to the health endpoint
curl -s -o nul -w "%%{http_code}" http://localhost:3000/api/health 2>nul | findstr "200" >nul
if not errorlevel 1 (
    echo.
    echo ==========================================
    echo [SUCCESS] KomuniPH server is running!
    echo ==========================================
    echo.
    echo Server: http://localhost:3000
    echo API:    http://localhost:3000/api/health
    echo.
    goto MENU
)

if %WAITED% geq %MAX_WAIT% (
    echo.
    echo ==========================================
    echo [ERROR] KOMUNIPH FAILED TO START
    echo ==========================================
    echo.
    echo The server did not become healthy within %MAX_WAIT% seconds.
    echo.
    echo Attempting to clean up...
    if defined SERVER_PID (
        taskkill /PID %SERVER_PID% /F >nul 2>&1
    )
    echo No unrelated Node processes were terminated.
    echo.
    pause
    exit /b 1
)

goto WAIT_LOOP
exit /b

REM ==========================================================
REM MENU - SUBROUTINE
REM ==========================================================

:MENU
echo Press L to shut down KomuniPH.
echo.

:MENU_LOOP
choice /c L /n /m "Press L to shutdown: "
if errorlevel 1 goto SHUTDOWN
goto MENU_LOOP
exit /b

REM ==========================================================
REM SHUTDOWN - SUBROUTINE
REM ==========================================================

:SHUTDOWN
echo.
echo Shutting down KomuniPH...
echo.

if defined SERVER_PID (
    echo [ACTION] Stopping KomuniPH server (PID %SERVER_PID%)...
    taskkill /PID %SERVER_PID% /F >nul 2>&1
    timeout /t 1 /nobreak >nul
    
    REM Verify port is released
    netstat -ano | findstr ":3000" >nul 2>&1
    if errorlevel 1 (
        echo [OK] Port 3000 released.
    ) else (
        echo [WARN] Port 3000 may still be in use.
        echo [INFO] Checking what is using port 3000...
        for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do set "REMAINING_PID=%%a"
        if defined REMAINING_PID (
            echo [INFO] Remaining process on port 3000: PID %REMAINING_PID%
            echo [INFO] This is NOT the KomuniPH process we started. It will not be terminated.
        )
    )
) else (
    echo [WARN] No server PID recorded.
)

echo.
echo KomuniPH stopped.
echo.

exit /b 0

REM ==========================================================
REM MAIN EXECUTION STARTS HERE
REM ==========================================================

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
REM DETERMINISTIC PID MANAGEMENT
REM ==========================================================

set "KOMUNIPH_DIR=%CD%"
set "SERVER_PID="

REM Function to find existing KomuniPH process by command line
echo [DEBUG] Checking for existing KomuniPH process...
set "EXISTING_PID="
for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%KOMUNIPH_DIR%\find_komuniph.ps1" 2^>nul') do (
    echo [DEBUG] Found existing PID: %%a
    set "EXISTING_PID=%%a"
)

if not defined EXISTING_PID goto NO_EXISTING

echo [INFO] KomuniPH is already running (PID %EXISTING_PID%).
echo [INFO] Reusing existing server.
set "SERVER_PID=%EXISTING_PID%"
call :VERIFY_HEALTH
goto :EOF

:NO_EXISTING
echo [DEBUG] No existing KomuniPH process found.

REM ==========================================================
REM CHECK PORT 3000
REM ==========================================================

echo [CHECK] Verifying port 3000 availability...
netstat -ano | findstr ":3000" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 3000 is already in use.
    echo [INFO] Checking if it's a KomuniPH process...
    
    REM Get PID using port 3000
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do set "PORT_PID=%%a"
    
    if defined PORT_PID (
        echo [INFO] Found process PID %PORT_PID% on port 3000.
        
        REM Check if it's a node.exe running server\index.js
        set "PORT_IS_KOMUNIPH="
        for /f "tokens=*" %%p in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%KOMUNIPH_DIR%\check_port_pid.ps1" %PORT_PID% 2^>nul') do set "PORT_IS_KOMUNIPH=%%p"
        
        if defined PORT_IS_KOMUNIPH (
            echo [INFO] Existing KomuniPH process (PID %PORT_PID%) found on port 3000.
            echo [ACTION] Stopping existing KomuniPH server (PID %PORT_PID%)...
            taskkill /PID %PORT_PID% /F >nul 2>&1
            timeout /t 1 /nobreak >nul
            echo [OK] Previous server stopped.
        ) else (
            echo [ERROR] Port 3000 is occupied by another application (PID %PORT_PID%).
            echo [ERROR] Cannot start KomuniPH. Please free port 3000 manually.
            pause
            exit /b 1
        )
    ) else (
        echo [ERROR] Port 3000 is in use but PID could not be determined.
        pause
        exit /b 1
    )
) else (
    echo [OK] Port 3000 is free.
)

REM ==========================================================
REM START SERVER WITH EXACT PID CAPTURE
REM ==========================================================

echo.
echo Starting KomuniPH server...
echo.

REM Use PowerShell helper to start the process and capture the exact PID
echo [DEBUG] Starting server via helper script...
for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%KOMUNIPH_DIR%\start_server.ps1" 2^>nul') do (
    echo [DEBUG] Server started with PID: %%a
    set "SERVER_PID=%%a"
)

if not defined SERVER_PID (
    echo [ERROR] Failed to start KomuniPH server.
    pause
    exit /b 1
)

echo [INFO] KomuniPH server started with PID %SERVER_PID%.

call :VERIFY_HEALTH
goto :EOF