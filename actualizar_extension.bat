@echo off
setlocal
title Actualizar Cargador de Tickets Smart Central

echo Descargando la ultima version desde GitHub...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0actualizar_extension.ps1"

if errorlevel 1 (
  echo.
  echo No se pudo actualizar la extension.
  echo Verifica la conexion a Internet y que el repositorio sea publico.
  pause
  exit /b 1
)

echo.
echo Actualizacion completada.
echo Abri chrome://extensions y pulsa Recargar en Cargador de Tickets Smart Central.
pause
