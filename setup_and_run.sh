#!/usr/bin/env bash
set -euo pipefail

echo "== Food Delivery v2 clean setup and run =="

if [ ! -f docker-compose.yml ]; then
  echo "Run this script inside the project root folder that contains docker-compose.yml"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is not running. Start Docker Desktop first."
  exit 1
fi

echo "Stopping any old stack and removing volumes for a clean database bootstrap..."
docker compose down -v --remove-orphans || true

echo "Starting clean build..."
docker compose up --build
