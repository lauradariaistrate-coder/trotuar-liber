@echo off
chcp 65001 >nul
setlocal
title Instalare Trotuar Liber
echo.
echo  Trotuar Liber - scurtatura pe Desktop
echo  -------------------------------------
echo  Adresa aplicatiei de pe GitHub Pages, de ex.:
echo  https://numele-tau.github.io/trotuar-liber/
echo.
set /p URL=Adresa:
if "%URL%"=="" (echo Adresa lipseste. & pause & exit /b 1)
echo %URL% | findstr /b /i "https://" >nul || (echo Adresa trebuie sa inceapa cu https:// & pause & exit /b 1)

set "DIR=%LOCALAPPDATA%\TrotuarLiber"
if not exist "%DIR%" mkdir "%DIR%"

set "BROWSER="
for %%P in ("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe") do (
  if not defined BROWSER if exist %%P set "BROWSER=%%~P"
)
if not defined BROWSER (echo Nu am gasit Edge sau Chrome. & pause & exit /b 1)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\Trotuar Liber.lnk');" ^
  "$s.TargetPath='%BROWSER%';" ^
  "$s.Arguments='--app=%URL% --user-data-dir=\"%DIR%\profile\"';" ^
  "$s.WorkingDirectory='%DIR%';" ^
  "$s.IconLocation='%SystemRoot%\System32\imageres.dll,109';" ^
  "$s.Description='Trotuar Liber - sesizari pietoni';" ^
  "$s.Save()"

echo.
echo  Gata: pe Desktop ai scurtatura "Trotuar Liber".
echo  Profilul browserului (login-ul aplicatiei) e in %DIR%\profile
echo.
pause
