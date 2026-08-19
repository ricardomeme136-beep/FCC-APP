@echo off
title WasteFlow - Cloudflare Tunnel
cd /d "C:\Program Files\Git\FCC-APP"

echo ========================================
echo   WASTEFLOW - CLOUDFLARE TUNNEL
echo ========================================
echo.
echo Mantem esta janela aberta.
echo O URL publico sera mostrado abaixo.
echo.

cloudflared tunnel --url http://localhost:8000

pause
