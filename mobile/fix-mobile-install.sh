#!/usr/bin/env bash
rm -rf node_modules package-lock.json
rm -f babel.config.cjs .babelrc
npm cache clean --force
npm install
echo "Run: npx expo start -c"
