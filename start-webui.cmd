@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "PYTHON_EXE=D:\Python\pythonw.exe"
set "SERVER_SCRIPT=%PROJECT_DIR%tools\serve_web.py"

if not exist "%PYTHON_EXE%" (
  echo Python was not found at %PYTHON_EXE%
  pause
  exit /b 1
)

if not exist "%SERVER_SCRIPT%" (
  echo Web server script was not found at %SERVER_SCRIPT%
  pause
  exit /b 1
)

start "Splatoon Farmers WebUI" /min "%PYTHON_EXE%" "%SERVER_SCRIPT%"
timeout /t 1 /nobreak >nul
start "" "http://localhost:4173/"

endlocal
