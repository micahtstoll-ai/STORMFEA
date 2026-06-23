@echo off
title STORMFEA - Nordic Storm 5962 (DEBUG MODE)
echo.
echo  ============================================
echo    STORMFEA  --  DEBUG MODE
echo  ============================================
echo.
echo  This enables two diagnostics:
echo.
echo  1. CG solver residual trend - prints at increasing
echo     iteration checkpoints (1, 2, 4, 8, ... then every 256).
echo     Use when an analysis fails to converge or times out.
echo.
echo  2. Gmsh surface classification - prints every detected
echo     surface's node count, bounding box, circle-fit stats
echo     (centroid/radius/std-dev), angular coverage, and final
echo     classification (hole_wall / outer_edge / top_face / etc).
echo     Use when a STEP file's detected hole positions or
echo     radii look wrong.
echo.
echo  Watch THIS window while you upload a file / click Analyse.
echo.

cd /d "%~dp0"

set STORMFEA_DEBUG_CG=1
set STORMFEA_DEBUG_SURFACES=1

if not exist "%~dp0node_modules\" (
    echo  Dependencies not installed yet. Run start.bat first.
    pause
    exit /b 1
)

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

echo  Syncing client files...
call node scripts/copy-client.mjs

echo  Starting STORMFEA (debug mode) at http://localhost:3000 ...
start "" powershell -WindowStyle Hidden -Command "Start-Sleep 3; Start-Process 'http://localhost:3000'"

npm start

pause
