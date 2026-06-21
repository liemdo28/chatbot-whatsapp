@echo off
REM PaddleOCR GPU Service Startup Script
cd /d "%~dp0"
call venv\Scripts\activate.bat
pip install paddlepaddle-gpu 2>nul
python app.py --gpu
