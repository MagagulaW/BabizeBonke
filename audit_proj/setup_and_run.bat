@echo off
setlocal

echo == Food Delivery v2 clean setup and run ==
if not exist docker-compose.yml (
  echo Run this file inside the project root folder that contains docker-compose.yml
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop is not running. Start Docker Desktop first.
  exit /b 1
)

docker compose down -v --remove-orphans
docker compose up --build
