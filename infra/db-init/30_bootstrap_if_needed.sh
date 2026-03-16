#!/bin/sh
set -eu

DB_URL="postgresql://postgres:postgres@db:5432/food_delivery"

wait_for_db() {
  echo "[db-init] Waiting for database to accept connections..."
  until pg_isready -h db -p 5432 -U postgres -d food_delivery >/dev/null 2>&1; do
    sleep 2
  done
}

table_exists() {
  psql "$DB_URL" -tAc "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users');"
}

seed_exists() {
  psql "$DB_URL" -tAc "SELECT EXISTS (SELECT 1 FROM public.users WHERE email = 'admin@foodsuite.local');" 2>/dev/null || echo f
}

wait_for_db

echo "[db-init] Checking schema state..."
if [ "$(table_exists)" != "t" ]; then
  echo "[db-init] Users table not found. Loading schema..."
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f /work/food_delivery.sql
else
  echo "[db-init] Schema already present."
fi

echo "[db-init] Applying compatibility migrations..."
psql "$DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
ALTER TABLE public.restaurants ADD COLUMN IF NOT EXISTS website_url text;
SQL

echo "[db-init] Checking seed state..."
if [ "$(seed_exists)" != "t" ]; then
  echo "[db-init] Seed data missing. Loading seed data..."
  psql "$DB_URL" -v ON_ERROR_STOP=1 -f /work/infra/db-init/20_seed.sql
else
  echo "[db-init] Seed data already present."
fi

echo "[db-init] Bootstrap completed successfully."
