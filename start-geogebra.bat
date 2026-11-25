@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if not "%~1"=="" set "GEOGEBRA_MCP_PORT=%~1"
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
) else (
  start "" node run-electron.js
)
