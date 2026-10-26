@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Instala Node.js LTS desde https://nodejs.org/ y vuelve a abrir este archivo.
 pause
 exit /b 1
)
if not exist node_modules (
 call npm ci
 if errorlevel 1 (
  echo No se pudieron instalar las dependencias. Revisa internet y la version de Node.js.
  pause
  exit /b 1
 )
)
echo Abre en tu navegador la direccion que aparezca debajo.
call npm run dev
pause
