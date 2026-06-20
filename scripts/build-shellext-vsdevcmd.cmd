@echo off
setlocal
call "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat" -arch=x64
if errorlevel 1 exit /b 1
cmake -S src\shell-ext-win -B src\shell-ext-win\build -A x64
if errorlevel 1 exit /b 1
cmake --build src\shell-ext-win\build --config Release
if errorlevel 1 exit /b 1
exit /b 0
