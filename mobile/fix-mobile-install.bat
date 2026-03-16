@echo off
echo Cleaning old mobile install...
if exist node_modules rmdir /s /q node_modules
if exist package-lock.json del /f /q package-lock.json
if exist babel.config.cjs del /f /q babel.config.cjs
if exist .babelrc del /f /q .babelrc
call npm cache clean --force
call npm install
echo Done. Start Expo with:
echo npx expo start -c
