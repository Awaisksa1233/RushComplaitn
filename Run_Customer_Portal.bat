@echo off
title RUSH Customer Care Portal
cd /d "%~dp0"
echo ============================================================
echo   Starting RUSH Car Wash Customer Care Portal API
echo   Backend: http://localhost:4000
echo   Frontend: http://localhost:4000/rush_wash_customer_care.html
echo ============================================================
npm run dev
pause
