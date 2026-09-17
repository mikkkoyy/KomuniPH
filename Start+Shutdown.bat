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
REM CHECK FOR EXISTING KOMUNIPH PROCESS ON PORT 3000
REM ==========================================================

echo [CHECK] Verifying port 3000 availability...

netstat -ano | findstr ":3000" >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 3000 is already in use.
    echo [INFO] Checking if it's a KomuniPH process...
    
    REM Get PID using port 3000
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do set PORT_PID=%%a
    
    if defined PORT_PID (
        echo [INFO] Found process PID %PORT_PID% on port 3000.
        
        REM Check if it's a node process
        tasklist /FI "PID eq %PORT_PID%" /FI "IMAGENAME eq node.exe" | findstr "node.exe" >nul 2>&1
        if not errorlevel 1 (
            echo [INFO] Existing Node process (PID %PORT_PID%) appears to be KomuniPH.
            echo [ACTION] Stopping existing KomuniPH server (PID %PORT_PID%)...
            taskkill /PID %PORT_PID% /F >nul 2>&1
            timeout /t 1 /nobreak >nul
            echo [OK] Previous server stopped.
        ) else (
            echo [ERROR] Port 3000 is occupied by a non-Node process (PID %PORT_PID%).
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
REM START SERVER
REM ==========================================================

echo.
echo Starting KomuniPH server...
echo.

REM Start server and capture its PID
start "KomuniPH Server" /b node server\index.js

REM Give the server a moment to start and get its PID
timeout /t 2 /nobreak >nul

REM Find the PID of the node process we just started
for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FI "WINDOWTITLE eq KomuniPH Server" /FO CSV /NH 2^>nul') do set SERVER_PID=%%~a

if not defined SERVER_PID (
    REM Fallback: find newest node process
    for /f "tokens=2" %%a in ('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH 2^>nul ^| findstr /v "PID"') do set SERVER_PID=%%~a
)

if defined SERVER_PID (
    echo [INFO] KomuniPH server started with PID %SERVER_PID%.
) else (
    echo [WARN] Could not determine server PID.
)

REM ==========================================================
REM VERIFY SERVER IS ACTUALLY RUNNING
REM ==========================================================

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
    echo [ERROR] Server failed to start within %MAX_WAIT% seconds.
    echo [ERROR] Check the console output above for errors.
    echo.
    echo Attempting to clean up...
    if defined SERVER_PID (
        taskkill /PID %SERVER_PID% /F >nul 2>&1
    )
    pause
    exit /b 1
)

goto WAIT_LOOP

:MENU
echo Press L to shut down KomuniPH.
echo.

:MENU_LOOP
choice /c L /n /m "Press L to shutdown: "
if errorlevel 1 goto SHUTDOWN
goto MENU_LOOP

:SHUTDOWN
echo.
echo Shutting down KomuniPH...
echo.

if defined SERVER_PID (
    echo [ACTION] Stopping server (PID %SERVER_PID%)...
    taskkill /PID %SERVER_PID% /F >nul 2>&1
    timeout /t 1 /nobreak >nul
    
    REM Verify port is released
    netstat -ano | findstr ":3000" >nul 2>&1
    if errorlevel 1 (
        echo [OK] Port 3000 released.
    ) else (
        echo [WARN] Port 3000 may still be in use.
    )
) else (
    echo [WARN] No server PID recorded, attempting generic node cleanup...
    taskkill /F /IM node.exe /FI "WINDOWTITLE eq KomuniPH Server" >nul 2>&1
)

echo.
echo KomuniPH stopped.
echo.

exit /b 0