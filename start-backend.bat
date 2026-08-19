@echo off
title WasteFlow - Backend
cd /d "C:\Program Files\Git\FCC-APP"

echo ========================================
echo   WASTEFLOW - BACKEND + MONGODB
echo ========================================
echo.

docker compose up -d
if errorlevel 1 (
  echo.
  echo ERRO: Docker nao arrancou.
  echo Confirma que o Docker Desktop esta aberto.
  pause
  exit /b 1
)

cd backend

if not exist ".venv\Scripts\python.exe" (
  echo A criar ambiente virtual Python...
  python -m venv .venv
)

if not exist ".env" (
  echo A criar backend .env...
  copy .env.example .env >nul
)

call .venv\Scripts\activate.bat

echo.
echo Backend a arrancar em http://localhost:8000
echo Health: http://localhost:8000/api/health
echo.
uvicorn server:app --reload --host 0.0.0.0 --port 8000

pause
