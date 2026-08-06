@echo off
setlocal EnableExtensions

REM === Edit these for your VPS ===
set "VPS_HOST=YOUR_VPS_IP_OR_HOSTNAME"
set "VPS_USER=root"
set "VPS_PORT=22"

REM Fixed local Steam workshop DedicatedServer package
set "LOCAL_SRC=C:\Program Files (x86)\Steam\steamapps\workshop\content\261550\3770450698\DedicatedServer"

REM Fixed VPS staging destination (panel default data root)
set "REMOTE_DIR=/var/lib/bannerlord-panel/staging/DedicatedServer"

if "%VPS_HOST%"=="YOUR_VPS_IP_OR_HOSTNAME" (
  echo ERROR: Set VPS_HOST at the top of this script first.
  exit /b 1
)

if not exist "%LOCAL_SRC%\BannerlordCoopServer.exe" (
  echo ERROR: BannerlordCoopServer.exe not found at:
  echo   %LOCAL_SRC%
  exit /b 1
)

where ssh >nul 2>&1
if errorlevel 1 (
  echo ERROR: OpenSSH "ssh" not found. Install OpenSSH Client from Windows Optional Features.
  exit /b 1
)
where scp >nul 2>&1
if errorlevel 1 (
  echo ERROR: OpenSSH "scp" not found. Install OpenSSH Client from Windows Optional Features.
  exit /b 1
)

echo Creating remote staging directory...
ssh -p %VPS_PORT% "%VPS_USER%@%VPS_HOST%" "mkdir -p '%REMOTE_DIR%'"
if errorlevel 1 (
  echo ERROR: ssh mkdir failed.
  exit /b 1
)

echo Uploading DedicatedServer to %VPS_USER%@%VPS_HOST%:%REMOTE_DIR%/
echo Source: %LOCAL_SRC%
scp -P %VPS_PORT% -r "%LOCAL_SRC%\*" "%VPS_USER%@%VPS_HOST%:%REMOTE_DIR%/"
if errorlevel 1 (
  echo ERROR: scp upload failed.
  exit /b 1
)

echo.
echo Done. Files are in staging only — open Installations in the panel to Inspect / Import.
echo   %REMOTE_DIR%
exit /b 0
