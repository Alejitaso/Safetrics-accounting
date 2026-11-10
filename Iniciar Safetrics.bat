@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "APP_URL=http://127.0.0.1:5173"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js no esta instalado o no esta disponible en PATH.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm no esta disponible en PATH.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%node_modules" (
  echo Faltan las dependencias del proyecto. Abre una terminal en esta carpeta y ejecuta:
  echo npm install
  pause
  exit /b 1
)

powershell.exe -NoProfile -Command "$tcp = Test-NetConnection 127.0.0.1 -Port 27017 -InformationLevel Quiet -WarningAction SilentlyContinue; if ($tcp) { exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 1 (
  echo MongoDB no esta escuchando en el puerto 27017. Intentando iniciar el servicio MongoDB...
  net start MongoDB
  if errorlevel 1 (
    echo No se pudo iniciar MongoDB. Inicia el servicio MongoDB desde Windows o ejecuta este iniciador como administrador.
    pause
    exit /b 1
  )
)

echo Esperando a MongoDB...
for /L %%I in (1,1,20) do (
  powershell.exe -NoProfile -Command "$tcp = Test-NetConnection 127.0.0.1 -Port 27017 -InformationLevel Quiet -WarningAction SilentlyContinue; if ($tcp) { exit 0 } else { exit 1 }" >nul 2>&1
  if not errorlevel 1 goto :mongodb_ready
  powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
)
echo MongoDB no respondio en 20 segundos.
pause
exit /b 1

:mongodb_ready
echo MongoDB esta disponible.

curl.exe --fail --silent http://127.0.0.1:4000/api/salud >nul 2>&1
if errorlevel 1 (
  echo Iniciando API...
  start "Safetrics - API" /D "%PROJECT_DIR%" cmd /k "npm run start --workspace=backend"
) else (
  echo La API ya esta en ejecucion.
)

curl.exe --fail --silent "%APP_URL%" >nul 2>&1
if errorlevel 1 (
  echo Iniciando interfaz web...
  start "Safetrics - Web" /D "%PROJECT_DIR%" cmd /k "npm run dev --workspace=frontend"
) else (
  echo La interfaz web ya esta en ejecucion.
)

echo Esperando a que la API y la interfaz esten listas...
for /L %%I in (1,1,60) do (
  curl.exe --fail --silent http://127.0.0.1:4000/api/salud >nul 2>&1
  if errorlevel 1 (
    powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
  ) else (
    curl.exe --fail --silent "%APP_URL%" >nul 2>&1
    if not errorlevel 1 goto :open_app
    powershell.exe -NoProfile -Command "Start-Sleep -Seconds 1"
  )
)

echo Los servidores no estuvieron listos dentro de 60 segundos.
echo Revisa las ventanas "Safetrics - API" y "Safetrics - Web" para ver el error.
pause
exit /b 1

:open_app
echo Abriendo Safetrics en el navegador...
start "" "%APP_URL%"
echo.
echo Deja abiertas las ventanas de API y Web mientras uses la aplicacion.
echo Cierra esas ventanas para detener los servidores.
exit /b 0
