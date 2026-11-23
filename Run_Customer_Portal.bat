@echo off
title RUSH Customer Care Portal
cd /d "%~dp0"
echo ============================================================
echo   RUSH Car Wash Customer Care Portal (production build)
echo   Customer portal: http://localhost:4000/
echo   Admin console:   http://localhost:4000/admin
echo   Requires a configured .env (see .env.example) incl. JWT_SECRET
echo ============================================================
call npm run build && npm start
pause
