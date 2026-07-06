@echo off
title EduSphere OCR Platform Launcher
echo ===================================================
echo   EduSphere Multi-OCR Platform Launcher
echo ===================================================
echo.
echo [1/2] Starting Python FastAPI Backend in a new window...
echo.
start "EduSphere OCR Python Backend" cmd /k "cd backend && python run.py"

echo [2/2] Launching Next.js/Tauri Frontend...
echo.
npm run dev

echo.
echo Launching process finished.
pause
