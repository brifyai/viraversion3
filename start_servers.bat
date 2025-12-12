@echo off
REM =====================================================
REM VIRA - Iniciar Servidores
REM =====================================================

echo.
echo ========================================
echo   VIRA - Iniciando Servidores
echo ========================================
echo.

REM Iniciar servidor TTS en nueva ventana
echo [1/2] Iniciando servidor TTS (Python)...
start "VIRA - TTS Server" cmd /k "cd F5_Test && venv\Scripts\activate && python app_f5.py"

REM Esperar 5 segundos para que TTS inicie
timeout /t 5 /nobreak >nul

REM Iniciar servidor Next.js en nueva ventana
echo [2/2] Iniciando servidor Web (Next.js)...
start "VIRA - Web Server" cmd /k "cd CODIGO_FUENTE && npm run dev"

echo.
echo ========================================
echo   SERVIDORES INICIADOS
echo ========================================
echo.
echo TTS Server: http://localhost:5000
echo Web Server: http://localhost:3000
echo.
echo Abre http://localhost:3000 en tu navegador
echo.
pause
