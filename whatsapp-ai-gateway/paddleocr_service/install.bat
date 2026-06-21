@echo off
REM PaddleOCR Service Installation Script
REM Run as Administrator

echo ====================================
echo PaddleOCR Service Installer
echo ====================================
echo.

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.9+ from python.org
    pause
    exit /b 1
)

REM Check pip
pip --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] pip not found. Please upgrade Python or install pip.
    pause
    exit /b 1
)

REM Create virtual environment
echo.
echo [1/4] Creating virtual environment...
if not exist "venv" (
    python -m venv venv
    if errorlevel 1 (
        echo [ERROR] Failed to create virtual environment
        pause
        exit /b 1
    )
)

REM Activate and upgrade pip
echo.
echo [2/4] Activating venv and upgrading pip...
call venv\Scripts\activate.bat
python -m pip install --upgrade pip

REM Install CPU-only PaddlePaddle (faster install, no GPU needed)
echo.
echo [3/4] Installing PaddlePaddle CPU...
pip install paddlepaddle -i https://mirror.baidu.com/pypi/simple
if errorlevel 1 (
    echo [WARNING] Baidu mirror failed, trying default...
    pip install paddlepaddle
)

REM Install remaining packages
echo.
echo [4/4] Installing OCR dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo [ERROR] Failed to install requirements
    pause
    exit /b 1
)

REM Download PaddleOCR models
echo.
echo [DONE] Installation complete!
echo.
echo To start the service:
echo   call venv\Scripts\activate.bat
echo   python app.py
echo.
pause
