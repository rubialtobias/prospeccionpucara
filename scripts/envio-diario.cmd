@echo off
rem Lo corre la tarea de Windows "Prospeccion Pucara - envio diario". Deja lo que pasó en data\envio-diario.log
cd /d "%~dp0.."
echo. >> data\envio-diario.log
echo ===== %date% %time% ===== >> data\envio-diario.log
"C:\Program Files\nodejs\node.exe" --env-file=.env src\enviar.mjs >> data\envio-diario.log 2>&1
