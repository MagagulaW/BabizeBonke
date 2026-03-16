#!/usr/bin/env bash
set -euo pipefail

echo "== Repairing, validating, and starting Food Delivery v2 =="

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

clean_dir() {
  local dir="$1"
  echo "Cleaning $dir ..."
  rm -rf "$dir/node_modules" "$dir/dist"
  rm -f "$dir/npm-debug.log"
}

clean_dir backend
clean_dir frontend

chmod +x infra/db-init/30_bootstrap_if_needed.sh || true

cat > backend/.dockerignore <<'DOCK'
node_modules
dist
npm-debug.log*
.env
DOCK

cat > frontend/.dockerignore <<'DOCK'
node_modules
dist
npm-debug.log*
.env
DOCK

mkdir -p frontend/src
cat > frontend/src/vite-env.d.ts <<'VITE'
/// <reference types="vite/client" />
VITE

echo "Testing backend build ..."
(
  cd backend
  npm install --no-audit --no-fund
  npm run build
)

echo "Testing frontend build ..."
(
  cd frontend
  npm install --no-audit --no-fund
  npm run build
)

echo "Resetting Docker stack and volumes ..."
docker compose down -v --remove-orphans || true

echo "Starting fresh build ..."
docker compose up --build
