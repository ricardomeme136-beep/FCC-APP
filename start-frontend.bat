@echo off
title WasteFlow - Frontend
cd /d "C:\Program Files\Git\FCC-APP\frontend"

echo ========================================
echo   WASTEFLOW - FRONTEND DEV CLIENT
echo ========================================
echo.

if not exist ".env" (
  echo A criar frontend .env...
  copy .env.example .env >nul
)

if not exist "node_modules" (
  echo A instalar dependencias npm...
  npm install
)

echo.
echo A arrancar Expo Development Client com tunnel...
echo.

npx expo start --dev-client --tunnel -c

pause