@echo off
title QuizzyFox Web Launcher
echo ===================================================
echo           Starting QuizzyFox Web System
echo         Created by InvestaPlay Studios
echo ===================================================
echo.

echo [1/2] Starting Backend Server on Port 4000...
start "QuizzyFox Backend (Port 4000)" cmd /k "cd /d %~dp0backend && npm run dev"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Web Frontend on Port 5173...
start "QuizzyFox Website (Port 5173)" cmd /k "cd /d %~dp0 && npm run dev"

timeout /t 2 /nobreak >nul

echo.
echo ===================================================
echo  Both Servers are running!
echo  Backend: http://localhost:4000
echo  Website: http://localhost:5173
echo ===================================================
echo Opening QuizzyFox Website in browser...
start http://localhost:5173
pause
