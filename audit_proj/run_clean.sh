#!/usr/bin/env bash
set -euo pipefail

if [ ! -f docker-compose.yml ]; then
  echo "Run this script inside the project root folder that contains docker-compose.yml"
  exit 1
fi

docker compose down -v --remove-orphans || true
docker compose up --build
