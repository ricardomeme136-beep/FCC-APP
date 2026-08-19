@echo off
title WasteFlow - Start All
cd /d "C:\Program Files\Git\FCC-APP"

echo ========================================
echo   WASTEFLOW - ARRANQUE COMPLETO
echo ========================================
echo.

tasklist /FI "IMAGENAME eq Docker Desktop.exe" 2>NUL | find /I "Docker Desktop.exe" >NUL
if errorlevel 1 (
  if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
    echo A abrir Docker Desktop...
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
    echo A aguardar 15 segundos...
    timeout /t 15 /nobreak >nul
  ) else (
    echo Docker Desktop nao encontrado automaticamente.
    echo Se o Docker ainda nao estiver aberto, abre-o manualmente.
  )
)

echo A abrir Backend...
start "WasteFlow Backend" cmd /k ""C:\Program Files\Git\FCC-APP\start-backend.bat""

echo A aguardar backend...
timeout /t 6 /nobreak >nul

echo A abrir Cloudflare Tunnel...
start "WasteFlow Cloudflare" cmd /k ""C:\Program Files\Git\FCC-APP\start-cloudflare.bat""

echo.
echo IMPORTANTE:
echo O Quick Tunnel da Cloudflare cria um URL novo em cada arranque.
echo Se o frontend .env ainda tiver o URL antigo, atualiza:
echo EXPO_PUBLIC_BACKEND_URL=https://NOVO-URL.trycloudflare.com
echo.
echo Depois carrega numa tecla para arrancar o frontend.
pause >nul

echo A abrir Frontend...
start "WasteFlow Frontend" cmd /k ""C:\Program Files\Git\FCC-APP\start-frontend.bat""

exit
