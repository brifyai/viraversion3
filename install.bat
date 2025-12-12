@echo off
REM =====================================================
REM VIRA - Script de Instalación para Windows
REM =====================================================

echo.
echo ========================================
echo   VIRA - Instalacion Automatica
echo ========================================
echo.

REM Verificar Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js no esta instalado.
    echo Descargalo de: https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js encontrado

REM Verificar Python
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python no esta instalado.
    echo Descargalo de: https://www.python.org/
    pause
    exit /b 1
)
echo [OK] Python encontrado

REM Instalar dependencias de Next.js
echo.
echo [1/3] Instalando dependencias del Frontend...
cd CODIGO_FUENTE
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Fallo la instalacion de npm
    pause
    exit /b 1
)
echo [OK] Dependencias de Frontend instaladas
cd ..

REM Crear entorno virtual de Python
echo.
echo [2/3] Configurando entorno Python...
cd F5_Test
if not exist venv (
    python -m venv venv
)
call venv\Scripts\activate.bat

REM Instalar PyTorch con CUDA
echo.
echo Instalando PyTorch con soporte CUDA...
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

REM Instalar dependencias de Python
echo.
echo [3/3] Instalando dependencias de Python...
pip install -r requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Fallo la instalacion de pip
    pause
    exit /b 1
)
echo [OK] Dependencias de Python instaladas
cd ..

echo.
echo ========================================
echo   INSTALACION COMPLETADA
echo ========================================
echo.
echo Pasos siguientes:
echo 1. Copia CODIGO_FUENTE\.env.example a CODIGO_FUENTE\.env.local
echo 2. Edita .env.local con tus credenciales
echo 3. Ejecuta: start_servers.bat
echo.
pause
