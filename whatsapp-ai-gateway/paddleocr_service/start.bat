@echo off
REM PaddleOCR Service Startup Script
cd /d "%~dp0"
call venv\Scripts\activate.bat
python app.py
