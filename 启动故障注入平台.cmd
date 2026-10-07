@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
if errorlevel 1 goto :project_error

where node.exe >nul 2>nul
if errorlevel 1 goto :node_error
where npm.cmd >nul 2>nul
if errorlevel 1 goto :node_error

set "PYTHON_EXE="
set "PYTHON_ARGS="
set "PYTHON_DIR="
py.exe -3 -c "import sys" >nul 2>nul
if not errorlevel 1 (
  set "PYTHON_EXE=py.exe"
  set "PYTHON_ARGS=-3"
)
if not defined PYTHON_EXE (
  python.exe -c "import sys" >nul 2>nul
  if not errorlevel 1 set "PYTHON_EXE=python.exe"
)
if not defined PYTHON_EXE (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do (
    if not defined PYTHON_EXE if exist "%%~fD\python.exe" (
      "%%~fD\python.exe" -c "import sys" >nul 2>nul
      if not errorlevel 1 (
        set "PYTHON_EXE=python.exe"
        set "PYTHON_DIR=%%~fD"
      )
    )
  )
)
if not defined PYTHON_EXE goto :python_error
if defined PYTHON_DIR set "PATH=%PYTHON_DIR%;%PATH%"

if not exist "node_modules\vite\bin\vite.js" (
  echo Installing frontend dependencies with npm ci...
  call npm.cmd ci
  if errorlevel 1 goto :npm_error
)

if /I "%~1"=="--check" (
  echo Prerequisites are ready.
  exit /b 0
)

where curl.exe >nul 2>nul
if errorlevel 1 goto :curl_error

call :backend_ready
if errorlevel 1 (
  echo Starting backend on http://127.0.0.1:8766/ ...
  start "Fault Injection Backend" /D "%~dp0" cmd.exe /k "%PYTHON_EXE% %PYTHON_ARGS% -u -m backend.server"
) else (
  echo Backend is already running on port 8766.
)

call :frontend_ready
if errorlevel 1 (
  echo Starting frontend on http://127.0.0.1:5173/ ...
  start "Fault Injection Frontend" /D "%~dp0" cmd.exe /k "node.exe node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 --strictPort"
) else (
  echo Frontend is already running on port 5173.
)

for /l %%I in (1,1,45) do (
  call :backend_ready
  if not errorlevel 1 (
    call :frontend_ready
    if not errorlevel 1 goto :open_browser
  )
  timeout /t 1 /nobreak >nul
)

echo Frontend or backend did not become ready within 45 seconds.
echo Check the two server windows for error details.
pause
exit /b 1

:open_browser
echo Both services are ready. Opening the platform...
start "" "http://127.0.0.1:5173/"
echo Close the Frontend and Backend windows when you want to stop the platform.
exit /b 0

:backend_ready
curl.exe --silent --max-time 1 "http://127.0.0.1:8766/" | findstr /c:"NOT_FOUND" >nul
exit /b %errorlevel%

:frontend_ready
curl.exe --fail --silent --max-time 1 "http://127.0.0.1:5173/" | findstr /c:"/src/main.js" >nul
exit /b %errorlevel%

:project_error
echo Could not open the project directory.
goto :failed
:node_error
echo Node.js and npm.cmd are required. Install Node.js and reopen this script.
goto :failed
:python_error
echo Python 3 is required. Install Python and reopen this script.
goto :failed
:npm_error
echo npm ci failed. Check network access or copy node_modules from a compatible Windows PC.
goto :failed
:curl_error
echo curl.exe is required to check that both services started.
goto :failed
:failed
pause
exit /b 1
