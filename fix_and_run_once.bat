@echo off
setlocal

echo == Repairing, validating, and starting Food Delivery v2 ==
if not exist docker-compose.yml (
  echo Run this file inside the project root folder that contains docker-compose.yml
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop is not running. Start Docker Desktop first.
  exit /b 1
)

if exist backend\node_modules rmdir /s /q backend\node_modules
if exist backend\dist rmdir /s /q backend\dist
if exist frontend\node_modules rmdir /s /q frontend\node_modules
if exist frontend\dist rmdir /s /q frontend\dist

echo Testing backend build ...
cd backend
call npm install --no-audit --no-fund
call npm run build
if errorlevel 1 exit /b 1
cd ..

echo Testing frontend build ...
cd frontend
call npm install --no-audit --no-fund
call npm run build
if errorlevel 1 exit /b 1
cd ..

echo Resetting Docker stack and volumes ...
docker compose down -v --remove-orphans

echo Starting fresh build ...
docker compose up --build
