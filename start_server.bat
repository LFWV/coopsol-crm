@echo off
title Coopsol CRM - Servidor Local

echo.
echo  =====================================
echo   Coopsol CRM - Iniciando servidor...
echo  =====================================
echo.

:: Verificar se Node.js está instalado
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERRO] Node.js nao encontrado.
    echo Instale em: https://nodejs.org
    pause
    exit /b 1
)

:: Instalar dependências se node_modules não existir
if not exist "node_modules\" (
    echo Instalando dependencias pela primeira vez...
    npm install
    echo.
)

:: Verificar se o .env existe e se o token foi configurado
if not exist ".env" (
    echo [AVISO] Arquivo .env nao encontrado.
    echo Crie o arquivo .env na pasta do projeto com seu AUTENTIQUE_TOKEN.
    echo.
)

:: Iniciar o servidor
echo Iniciando servidor...
echo Para parar: pressione Ctrl+C
echo.
node server.js

pause
