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
  echo No se pudieron instalar las dependencias. Revisa internet y Node.js.
  pause
  exit /b 1
 )
)
echo Conecta el telefono a la misma red Wi-Fi que esta computadora.
echo En la terminal, abre Network y usa la direccion que diga http://...
echo Para instalar la PWA y usar la ubicacion hace falta HTTPS; publica en Vercel.
call npm run dev -- --host 0.0.0.0
pause
