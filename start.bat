@echo off
title STORMFEA - Nordic Storm 5962
echo.
echo  ============================================
echo    STORMFEA  --  Nordic Storm FTC 5962
echo  ============================================
echo.

cd /d "%~dp0"

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js not found.
    echo  Download and install from https://nodejs.org
    echo  Then run this file again.
    pause
    exit /b 1
)

:: Install dependencies if node_modules missing
if not exist "%~dp0node_modules\" (
    echo  Installing dependencies ^(first run^)...
    call npm install
    if errorlevel 1 (
        echo  ERROR: npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
    echo.
)

:: Build TypeScript if dist/server/index.js is missing
if not exist "%~dp0dist\server\index.js" (
    echo  Compiling TypeScript...
    call npm run build
    if errorlevel 1 (
        echo  ERROR: Build failed. See errors above.
        pause
        exit /b 1
    )
    echo.
)

:: Always sync client/index.html into dist/client/ before starting
:: This ensures the UI is always up to date even if only index.html changed
echo  Syncing client files...
call node scripts/copy-client.mjs
if errorlevel 1 (
    echo  WARNING: Client sync failed. UI may be stale.
    echo.
)

:: Check Gmsh
gmsh --version >nul 2>&1
if errorlevel 1 (
    echo  WARNING: Gmsh not found.
    echo  STEP files and Onshape import will not work.
    echo  Fix: open PowerShell and run:  winget install Gmsh.Gmsh
    echo.
)

:: Check TetGen
if not exist "%~dp0tetgen.exe" (
    echo  WARNING: tetgen.exe not found in this folder.
    echo  STL file meshing will not work.
    echo  Download from: github.com/emersonkeenan/tetgen1.5.1-beta1/releases
    echo  Place tetgen.exe in the same folder as this file.
    echo.
)

:: Open browser after 3 second delay
echo  Starting STORMFEA at http://localhost:3000 ...
start "" powershell -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process 'http://localhost:3000'"

:: Start the server
npm start

pause
