BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- FULL REDESIGN: Food Delivery Platform Schema
-- PostgreSQL 14+
-- This version intentionally breaks backward compatibility in favor
-- of stronger normalization, auditability, scalability, and role flexibility.
-- ============================================================

-- Drop only app-owned views (skip PostGIS extension-owned views)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT v.schemaname, v.viewname
    FROM pg_views v
    WHERE v.schemaname = 'public'
      AND v.viewname NOT IN ('geography_columns', 'geometry_columns', 'raster_columns', 'raster_overviews')
  ) LOOP
    EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', r.schemaname, r.viewname);
  END LOOP;
END $$;

-- Drop only app-owned tables (skip PostGIS extension-owned tables)
DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN (
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('spatial_ref_sys')
  ) LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t.tablename);
  END LOOP;
END $$;

-- Drop custom types
DO $$
DECLARE ty RECORD;
BEGIN
  FOR ty IN (
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'
  ) LOOP
    EXECUTE format('DROP TYPE IF EXISTS %I CASCADE', ty.typname);
  END LOOP;
END $$;

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE account_status AS ENUM ('pending_verification','active','suspended','disabled');
CREATE TYPE restaurant_status AS ENUM ('draft','pending_review','approved','rejected','suspended','closed');
CREATE TYPE membership_status AS ENUM ('invited','active','suspended','revoked');
CREATE TYPE address_type AS ENUM ('home','work','other');
CREATE TYPE coupon_discount_type AS ENUM ('percent','fixed','free_delivery');
CREATE TYPE coupon_scope_type AS ENUM ('platform','restaurant','zone','user_segment','specific_user');
CREATE TYPE coupon_redemption_status AS ENUM ('reserved','redeemed','reversed','expired');
CREATE TYPE order_type AS ENUM ('delivery','pickup');
CREATE TYPE order_status AS ENUM (
  'draft','placed','confirmed','preparing','ready_for_pickup','picked_up','out_for_delivery','delivered','cancelled','refund_pending','refunded'
);
CREATE TYPE order_actor_type AS ENUM ('system','customer','restaurant','driver','admin','support');
CREATE TYPE delivery_status AS ENUM (
  'awaiting_dispatch','offer_in_progress','assigned','accepted','en_route_to_pickup','arrived_at_pickup','picked_up','en_route_to_dropoff','arrived_at_dropoff','delivered','failed','cancelled'
);
CREATE TYPE assignment_status AS ENUM ('offered','accepted','rejected','timed_out','cancelled','expired','reassigned');
CREATE TYPE payment_status AS ENUM ('initiated','authorized','captured','failed','voided','refunded','partially_refunded');
CREATE TYPE payment_attempt_status AS ENUM ('pending','processing','succeeded','failed','cancelled','timed_out');
CREATE TYPE refund_status AS ENUM ('requested','approved','rejected','processed','failed');
CREATE TYPE payout_status AS ENUM ('pending','approved','processing','paid','failed','reversed');
CREATE TYPE payout_party_type AS ENUM ('driver','restaurant');
CREATE TYPE bank_account_holder_type AS ENUM ('user','restaurant');
CREATE TYPE vehicle_status AS ENUM ('pending','approved','rejected','inactive');
CREATE TYPE support_ticket_status AS ENUM ('open','in_progress','resolved','closed');
CREATE TYPE media_owner_type AS ENUM ('user','restaurant','menu_item','promotion','ticket');

-- ============================================================
-- COMMON FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_single_default_address()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE user_addresses
    SET is_default = false,
        updated_at = now()
    WHERE user_id = NEW.user_id
      AND id <> COALESCE(NEW.id, gen_random_uuid())
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_single_primary_restaurant_contact()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_primary THEN
    UPDATE restaurant_memberships
    SET is_primary = false,
        updated_at = now()
    WHERE restaurant_id = NEW.restaurant_id
      AND id <> COALESCE(NEW.id, gen_random_uuid())
      AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_single_primary_bank_account()
RETURNS trigger AS $$
BEGIN
  IF NEW.is_primary THEN
    UPDATE bank_accounts
    SET is_primary = false,
        updated_at = now()
    WHERE holder_type = NEW.holder_type
      AND holder_id = NEW.holder_id
      AND id <> COALESCE(NEW.id, gen_random_uuid())
      AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- IDENTITY / ACCESS / USERS
-- ============================================================

CREATE TABLE roles (
  code text PRIMARY KEY,
  description text NOT NULL
);

INSERT INTO roles (code, description) VALUES
('platform_admin', 'Full platform administration'),
('finance_admin', 'Finance and settlements administration'),
('content_admin', 'Content and promotions administration'),
('support_admin', 'Support and customer operations administration'),
('customer', 'Customer placing orders'),
('driver', 'Delivery driver'),
('restaurant_owner', 'Restaurant owner'),
('restaurant_manager', 'Restaurant manager'),
('restaurant_staff', 'Restaurant staff member');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  phone text UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  first_name text GENERATED ALWAYS AS (split_part(full_name, ' ', 1)) STORED,
  last_name text GENERATED ALWAYS AS (NULLIF(regexp_replace(full_name, '^\\S+\\s*', ''), '')) STORED,
  status account_status NOT NULL DEFAULT 'pending_verification',
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  last_login_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (email <> ''),
  CHECK (phone IS NULL OR phone <> '')
);

CREATE INDEX users_email_trgm_idx ON users USING gin (email gin_trgm_ops);
CREATE INDEX users_full_name_trgm_idx ON users USING gin (full_name gin_trgm_ops);
CREATE INDEX users_status_idx ON users(status);

CREATE TRIGGER trg_users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_code)
);

CREATE INDEX user_roles_role_idx ON user_roles(role_code);

CREATE TABLE customer_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  marketing_opt_in boolean NOT NULL DEFAULT false,
  loyalty_points integer NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  preferred_language text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_customer_profiles_set_updated_at
BEFORE UPDATE ON customer_profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  onboarding_status text NOT NULL DEFAULT 'pending' CHECK (onboarding_status IN ('pending','approved','rejected','suspended')),
  license_number text,
  license_expiry_date date,
  national_id_number text,
  emergency_contact_name text,
  emergency_contact_phone text,
  rating numeric(3,2) NOT NULL DEFAULT 5.00 CHECK (rating BETWEEN 0 AND 5),
  total_deliveries integer NOT NULL DEFAULT 0 CHECK (total_deliveries >= 0),
  available_for_dispatch boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_profiles_status_idx ON driver_profiles(onboarding_status);

CREATE TRIGGER trg_driver_profiles_set_updated_at
BEFORE UPDATE ON driver_profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE admin_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  department text,
  can_impersonate boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_admin_profiles_set_updated_at
BEFORE UPDATE ON admin_profiles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address_type address_type NOT NULL DEFAULT 'other',
  label text,
  address_line1 text NOT NULL,
  address_line2 text,
  suburb text,
  city text NOT NULL,
  province text,
  postal_code text,
  country text NOT NULL DEFAULT 'ZA',
  location geography(Point, 4326) NOT NULL,
  latitude double precision GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  longitude double precision GENERATED ALWAYS AS (ST_X(location::geometry)) STORED,
  delivery_instructions text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX user_addresses_user_idx ON user_addresses(user_id);
CREATE INDEX user_addresses_geo_idx ON user_addresses USING gist (location);

CREATE TRIGGER trg_user_addresses_set_updated_at
BEFORE UPDATE ON user_addresses
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_user_addresses_single_default
BEFORE INSERT OR UPDATE ON user_addresses
FOR EACH ROW
EXECUTE FUNCTION enforce_single_default_address();

-- ============================================================
-- RESTAURANTS / STAFF / OPERATIONS
-- ============================================================

CREATE TABLE restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL,
  display_name text NOT NULL,
  trading_name text,
  description text,
  support_email text,
  support_phone text,
  website_url text,
  tax_number text,
  registration_number text,
  status restaurant_status NOT NULL DEFAULT 'draft',
  onboarding_step text,
  cuisine_tags text[] NOT NULL DEFAULT '{}'::text[],
  commission_rate numeric(5,2) NOT NULL DEFAULT 15.00 CHECK (commission_rate >= 0 AND commission_rate <= 100),
  prep_time_min_mins integer CHECK (prep_time_min_mins >= 0),
  prep_time_max_mins integer CHECK (prep_time_max_mins >= 0),
  accepts_pickup boolean NOT NULL DEFAULT true,
  accepts_delivery boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (display_name <> ''),
  CHECK (prep_time_max_mins IS NULL OR prep_time_min_mins IS NULL OR prep_time_max_mins >= prep_time_min_mins)
);

CREATE INDEX restaurants_status_idx ON restaurants(status);
CREATE INDEX restaurants_display_name_trgm_idx ON restaurants USING gin (display_name gin_trgm_ops);
CREATE INDEX restaurants_legal_name_trgm_idx ON restaurants USING gin (legal_name gin_trgm_ops);

CREATE TRIGGER trg_restaurants_set_updated_at
BEFORE UPDATE ON restaurants
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE restaurant_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  location_name text,
  address_line1 text NOT NULL,
  address_line2 text,
  suburb text,
  city text NOT NULL,
  province text,
  postal_code text,
  country text NOT NULL DEFAULT 'ZA',
  location geography(Point,4326) NOT NULL,
  latitude double precision GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  longitude double precision GENERATED ALWAYS AS (ST_X(location::geometry)) STORED,
  delivery_radius_km numeric(8,2) CHECK (delivery_radius_km >= 0),
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX restaurant_locations_rest_idx ON restaurant_locations(restaurant_id);
CREATE INDEX restaurant_locations_geo_idx ON restaurant_locations USING gist (location);

CREATE TRIGGER trg_restaurant_locations_set_updated_at
BEFORE UPDATE ON restaurant_locations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE restaurant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
  status membership_status NOT NULL DEFAULT 'active',
  is_primary boolean NOT NULL DEFAULT false,
  invited_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, user_id, role_code),
  CHECK (role_code IN ('restaurant_owner','restaurant_manager','restaurant_staff'))
);

CREATE INDEX restaurant_memberships_rest_idx ON restaurant_memberships(restaurant_id);
CREATE INDEX restaurant_memberships_user_idx ON restaurant_memberships(user_id);
CREATE INDEX restaurant_memberships_role_idx ON restaurant_memberships(role_code);

CREATE TRIGGER trg_restaurant_memberships_set_updated_at
BEFORE UPDATE ON restaurant_memberships
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_restaurant_memberships_single_primary
BEFORE INSERT OR UPDATE ON restaurant_memberships
FOR EACH ROW
EXECUTE FUNCTION enforce_single_primary_restaurant_contact();

CREATE TABLE restaurant_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_location_id uuid NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens_at time,
  closes_at time,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_location_id, weekday),
  CHECK (
    (is_closed = true AND opens_at IS NULL AND closes_at IS NULL)
    OR
    (is_closed = false AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)
  )
);

CREATE TABLE delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text,
  province text,
  zone_polygon geometry(MultiPolygon, 4326) NOT NULL,
  minimum_order_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (minimum_order_total >= 0),
  base_delivery_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_delivery_fee >= 0),
  surge_multiplier numeric(8,4) NOT NULL DEFAULT 1.0 CHECK (surge_multiplier >= 0.0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX delivery_zones_geom_idx ON delivery_zones USING gist (zone_polygon);

CREATE TRIGGER trg_delivery_zones_set_updated_at
BEFORE UPDATE ON delivery_zones
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE restaurant_delivery_zones (
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  delivery_zone_id uuid NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (restaurant_id, delivery_zone_id)
);

-- ============================================================
-- MENU / CATALOG
-- ============================================================

CREATE TABLE menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, name),
  UNIQUE (restaurant_id, id)
);

CREATE INDEX menu_categories_rest_idx ON menu_categories(restaurant_id);

CREATE TRIGGER trg_menu_categories_set_updated_at
BEFORE UPDATE ON menu_categories
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id uuid,
  name text NOT NULL,
  description text,
  image_url text,
  sku text,
  base_price numeric(12,2) NOT NULL CHECK (base_price >= 0),
  currency text NOT NULL DEFAULT 'ZAR',
  is_vegetarian boolean NOT NULL DEFAULT false,
  is_vegan boolean NOT NULL DEFAULT false,
  is_halal boolean NOT NULL DEFAULT false,
  is_available boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  prep_time_override_mins integer CHECK (prep_time_override_mins >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, sku),
  UNIQUE (restaurant_id, id),
  FOREIGN KEY (restaurant_id, category_id) REFERENCES menu_categories(restaurant_id, id) ON DELETE SET NULL
);

CREATE INDEX menu_items_rest_idx ON menu_items(restaurant_id);
CREATE INDEX menu_items_cat_idx ON menu_items(category_id);
CREATE INDEX menu_items_name_trgm_idx ON menu_items USING gin (name gin_trgm_ops);

CREATE TRIGGER trg_menu_items_set_updated_at
BEFORE UPDATE ON menu_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE modifier_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  min_select integer NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select integer NOT NULL DEFAULT 1 CHECK (max_select >= 1),
  is_required boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, name),
  UNIQUE (restaurant_id, id),
  CHECK (max_select >= min_select)
);

CREATE INDEX modifier_groups_rest_idx ON modifier_groups(restaurant_id);

CREATE TRIGGER trg_modifier_groups_set_updated_at
BEFORE UPDATE ON modifier_groups
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE modifier_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modifier_group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  price_delta numeric(12,2) NOT NULL DEFAULT 0 CHECK (price_delta >= 0),
  is_default boolean NOT NULL DEFAULT false,
  is_available boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (modifier_group_id, name)
);

CREATE INDEX modifier_options_group_idx ON modifier_options(modifier_group_id);

CREATE TRIGGER trg_modifier_options_set_updated_at
BEFORE UPDATE ON modifier_options
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE menu_item_modifier_groups (
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  modifier_group_id uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (menu_item_id, modifier_group_id)
);

CREATE INDEX menu_item_modifier_groups_group_idx ON menu_item_modifier_groups(modifier_group_id);

-- ============================================================
-- PROMOTIONS / COUPONS / CONTENT
-- ============================================================

CREATE TABLE promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  banner_image_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TRIGGER trg_promotions_set_updated_at
BEFORE UPDATE ON promotions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  discount_type coupon_discount_type NOT NULL,
  discount_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  min_order_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_order_total >= 0),
  max_discount_amount numeric(12,2) CHECK (max_discount_amount >= 0),
  max_redemptions integer CHECK (max_redemptions > 0),
  per_user_limit integer NOT NULL DEFAULT 1 CHECK (per_user_limit > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  scope_type coupon_scope_type NOT NULL DEFAULT 'platform',
  first_order_only boolean NOT NULL DEFAULT false,
  is_stackable boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX coupons_active_idx ON coupons(is_active);
CREATE INDEX coupons_code_trgm_idx ON coupons USING gin (code gin_trgm_ops);

CREATE TRIGGER trg_coupons_set_updated_at
BEFORE UPDATE ON coupons
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE coupon_restaurants (
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, restaurant_id)
);

CREATE TABLE coupon_zones (
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  delivery_zone_id uuid NOT NULL REFERENCES delivery_zones(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, delivery_zone_id)
);

CREATE TABLE coupon_users (
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (coupon_id, user_id)
);

CREATE TABLE coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid NOT NULL REFERENCES coupons(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  order_id uuid,
  status coupon_redemption_status NOT NULL DEFAULT 'reserved',
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coupon_id, user_id, order_id)
);

CREATE INDEX coupon_redemptions_coupon_idx ON coupon_redemptions(coupon_id);
CREATE INDEX coupon_redemptions_user_idx ON coupon_redemptions(user_id);
CREATE INDEX coupon_redemptions_status_idx ON coupon_redemptions(status);

-- ============================================================
-- ORDERS / CART SNAPSHOT / DELIVERY
-- ============================================================

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE RESTRICT,
  restaurant_location_id uuid REFERENCES restaurant_locations(id) ON DELETE RESTRICT,
  order_type order_type NOT NULL DEFAULT 'delivery',
  status order_status NOT NULL DEFAULT 'placed',
  delivery_address_id uuid REFERENCES user_addresses(id) ON DELETE SET NULL,
  delivery_zone_id uuid REFERENCES delivery_zones(id) ON DELETE SET NULL,
  special_instructions text,
  subtotal_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  item_discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (item_discount_amount >= 0),
  coupon_discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (coupon_discount_amount >= 0),
  service_fee_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (service_fee_amount >= 0),
  delivery_fee_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee_amount >= 0),
  tip_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency text NOT NULL DEFAULT 'ZAR',
  coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL,
  coupon_redemption_id uuid UNIQUE,
  placed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  ready_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (order_type = 'pickup' AND delivery_address_id IS NULL)
    OR (order_type = 'delivery')
  )
);

CREATE INDEX orders_customer_idx ON orders(customer_user_id);
CREATE INDEX orders_restaurant_idx ON orders(restaurant_id);
CREATE INDEX orders_status_idx ON orders(status);
CREATE INDEX orders_placed_at_idx ON orders(placed_at DESC);

CREATE TRIGGER trg_orders_set_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

ALTER TABLE coupon_redemptions
  ADD CONSTRAINT coupon_redemptions_order_fk
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE orders
  ADD CONSTRAINT orders_coupon_redemption_fk
  FOREIGN KEY (coupon_redemption_id) REFERENCES coupon_redemptions(id) ON DELETE SET NULL;

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  sku text,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  base_total numeric(12,2) NOT NULL CHECK (base_total >= 0),
  modifier_total numeric(12,2) NOT NULL DEFAULT 0 CHECK (modifier_total >= 0),
  line_discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (line_discount_amount >= 0),
  line_total numeric(12,2) NOT NULL CHECK (line_total >= 0),
  item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_items_order_idx ON order_items(order_id);

CREATE TABLE order_item_selected_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  modifier_group_name text NOT NULL,
  option_name text NOT NULL,
  unit_price_delta numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price_delta >= 0),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_price_delta numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_price_delta >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_item_selected_options_item_idx ON order_item_selected_options(order_item_id);

CREATE TABLE order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status order_status,
  actor_type order_actor_type NOT NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_name text NOT NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_events_order_idx ON order_events(order_id, created_at DESC);

CREATE TABLE deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  current_driver_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status delivery_status NOT NULL DEFAULT 'awaiting_dispatch',
  dispatch_started_at timestamptz,
  assigned_at timestamptz,
  accepted_at timestamptz,
  arrived_at_pickup_at timestamptz,
  picked_up_at timestamptz,
  arrived_at_dropoff_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  pickup_eta_mins integer CHECK (pickup_eta_mins >= 0),
  dropoff_eta_mins integer CHECK (dropoff_eta_mins >= 0),
  driver_payout_estimate numeric(12,2) NOT NULL DEFAULT 0 CHECK (driver_payout_estimate >= 0),
  proof_of_delivery jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deliveries_driver_idx ON deliveries(current_driver_user_id);
CREATE INDEX deliveries_status_idx ON deliveries(status);

CREATE TRIGGER trg_deliveries_set_updated_at
BEFORE UPDATE ON deliveries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE delivery_assignment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  driver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  status assignment_status NOT NULL,
  offered_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  reason text,
  assigned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (delivery_id, attempt_no),
  UNIQUE (delivery_id, driver_user_id, attempt_no)
);

CREATE INDEX delivery_assignment_attempts_delivery_idx ON delivery_assignment_attempts(delivery_id, offered_at DESC);
CREATE INDEX delivery_assignment_attempts_driver_idx ON delivery_assignment_attempts(driver_user_id, offered_at DESC);

CREATE TABLE delivery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  status delivery_status,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event_name text NOT NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX delivery_events_delivery_idx ON delivery_events(delivery_id, created_at DESC);

-- ============================================================
-- PAYMENTS / REFUNDS / PAYOUTS
-- ============================================================

CREATE TABLE payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  method_type text NOT NULL CHECK (method_type IN ('card','wallet','cash','bank_transfer','manual')),
  provider text,
  provider_customer_reference text,
  provider_payment_method_reference text,
  last4 text,
  brand text,
  expires_month smallint CHECK (expires_month BETWEEN 1 AND 12),
  expires_year integer CHECK (expires_year >= 2000),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_methods_user_idx ON payment_methods(user_id);

CREATE TRIGGER trg_payment_methods_set_updated_at
BEFORE UPDATE ON payment_methods
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  provider text NOT NULL,
  provider_payment_reference text,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'ZAR',
  status payment_status NOT NULL DEFAULT 'initiated',
  authorized_at timestamptz,
  captured_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_order_idx ON payments(order_id, created_at DESC);
CREATE INDEX payments_status_idx ON payments(status);

CREATE TRIGGER trg_payments_set_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  provider text NOT NULL,
  provider_attempt_reference text,
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  status payment_attempt_status NOT NULL DEFAULT 'pending',
  failure_code text,
  failure_message text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (payment_id, attempt_no)
);

CREATE INDEX payment_attempts_payment_idx ON payment_attempts(payment_id, attempt_no DESC);
CREATE INDEX payment_attempts_status_idx ON payment_attempts(status);

CREATE TABLE refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'ZAR',
  reason text,
  status refund_status NOT NULL DEFAULT 'requested',
  provider_refund_reference text,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refunds_payment_idx ON refunds(payment_id);
CREATE INDEX refunds_status_idx ON refunds(status);

CREATE TRIGGER trg_refunds_set_updated_at
BEFORE UPDATE ON refunds
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_type bank_account_holder_type NOT NULL,
  holder_id uuid NOT NULL,
  account_name text NOT NULL,
  bank_name text NOT NULL,
  account_number_masked text NOT NULL,
  branch_code text,
  account_type text,
  provider_token text,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (holder_type, holder_id, provider_token)
);

CREATE INDEX bank_accounts_holder_idx ON bank_accounts(holder_type, holder_id);

CREATE TRIGGER trg_bank_accounts_set_updated_at
BEFORE UPDATE ON bank_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_bank_accounts_single_primary
BEFORE INSERT OR UPDATE ON bank_accounts
FOR EACH ROW
EXECUTE FUNCTION enforce_single_primary_bank_account();

CREATE TABLE payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type payout_party_type NOT NULL,
  party_id uuid NOT NULL,
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'ZAR',
  status payout_status NOT NULL DEFAULT 'pending',
  reference text,
  period_start timestamptz,
  period_end timestamptz,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payouts_party_idx ON payouts(party_type, party_id, created_at DESC);
CREATE INDEX payouts_status_idx ON payouts(status);

CREATE TRIGGER trg_payouts_set_updated_at
BEFORE UPDATE ON payouts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE payout_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  item_type text NOT NULL CHECK (item_type IN ('restaurant_order_earning','driver_delivery_earning','tip','adjustment','refund_reversal','penalty')),
  gross_amount numeric(12,2) NOT NULL DEFAULT 0,
  fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payout_items_payout_idx ON payout_items(payout_id);

-- ============================================================
-- DRIVER VEHICLES / SAFETY / TRACKING
-- ============================================================

CREATE TABLE driver_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('bike','motorbike','car','van','other')),
  make text,
  model text,
  year integer CHECK (year >= 1900),
  color text,
  registration_number text,
  status vehicle_status NOT NULL DEFAULT 'pending',
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (registration_number)
);

CREATE INDEX driver_vehicles_driver_idx ON driver_vehicles(driver_user_id);

CREATE TRIGGER trg_driver_vehicles_set_updated_at
BEFORE UPDATE ON driver_vehicles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE driver_background_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text,
  criminal_record_status text,
  driving_record_status text,
  vehicle_inspection_status text,
  checked_at timestamptz,
  expires_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_background_checks_driver_idx ON driver_background_checks(driver_user_id, checked_at DESC);

CREATE TABLE driver_location_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location geography(Point,4326) NOT NULL,
  latitude double precision GENERATED ALWAYS AS (ST_Y(location::geometry)) STORED,
  longitude double precision GENERATED ALWAYS AS (ST_X(location::geometry)) STORED,
  speed_kph numeric(10,2),
  heading_deg numeric(10,2),
  accuracy_m numeric(10,2),
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE driver_location_history_default PARTITION OF driver_location_history DEFAULT;
CREATE INDEX driver_location_history_default_driver_time_idx ON driver_location_history_default(driver_user_id, recorded_at DESC);
CREATE INDEX driver_location_history_default_geo_idx ON driver_location_history_default USING gist (location);

CREATE TABLE driver_telematics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL,
  PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

CREATE TABLE driver_telematics_default PARTITION OF driver_telematics DEFAULT;
CREATE INDEX driver_telematics_default_driver_time_idx ON driver_telematics_default(driver_user_id, recorded_at DESC);
CREATE INDEX driver_telematics_default_payload_gin_idx ON driver_telematics_default USING gin (payload);

CREATE TABLE sos_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  location geography(Point,4326),
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sos_events_driver_idx ON sos_events(driver_user_id, created_at DESC);

CREATE TABLE trip_safety_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id uuid REFERENCES deliveries(id) ON DELETE CASCADE,
  driver_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  severity text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_safety_events_delivery_idx ON trip_safety_events(delivery_id, created_at DESC);

-- ============================================================
-- SUPPORT / CONTENT / MEDIA / AUDIT
-- ============================================================

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type media_owner_type NOT NULL,
  owner_id uuid NOT NULL,
  file_url text NOT NULL,
  mime_type text,
  alt_text text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX media_assets_owner_idx ON media_assets(owner_type, owner_id);

CREATE TABLE featured_restaurants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  promotion_id uuid REFERENCES promotions(id) ON DELETE SET NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX featured_restaurants_rest_idx ON featured_restaurants(restaurant_id);

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  subject text NOT NULL,
  description text,
  status support_ticket_status NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_tickets_status_idx ON support_tickets(status);
CREATE INDEX support_tickets_requester_idx ON support_tickets(requester_user_id);

CREATE TRIGGER trg_support_tickets_set_updated_at
BEFORE UPDATE ON support_tickets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  message text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX support_ticket_messages_ticket_idx ON support_ticket_messages(ticket_id, created_at);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_name text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx ON audit_log(entity_name, entity_id, created_at DESC);
CREATE INDEX audit_log_actor_idx ON audit_log(actor_user_id, created_at DESC);

-- ============================================================
-- VIEWS
-- ============================================================

CREATE VIEW restaurants_search_view AS
SELECT
  r.id,
  r.display_name,
  r.legal_name,
  r.status,
  rl.city,
  rl.province,
  rl.country,
  ST_Y(rl.location::geometry) AS lat,
  ST_X(rl.location::geometry) AS lng,
  r.commission_rate,
  r.accepts_delivery,
  r.accepts_pickup,
  r.is_active,
  r.created_at,
  r.updated_at
FROM restaurants r
LEFT JOIN restaurant_locations rl
  ON rl.restaurant_id = r.id
 AND rl.is_primary = true;

CREATE VIEW user_addresses_view AS
SELECT
  a.*, 
  ST_Y(a.location::geometry) AS lat_view,
  ST_X(a.location::geometry) AS lng_view
FROM user_addresses a;

CREATE VIEW restaurant_locations_view AS
SELECT
  rl.*, 
  ST_Y(rl.location::geometry) AS lat_view,
  ST_X(rl.location::geometry) AS lng_view
FROM restaurant_locations rl;


-- ============================================================
-- V2 EXTENSIONS: CARTS / REVIEWS / INVENTORY / NOTIFICATIONS /
-- TAX / DRIVER SHIFTS / SURGE / WEBHOOKS / FRAUD / LOYALTY
-- ============================================================

CREATE TYPE inventory_tracking_mode AS ENUM ('none','simple');
CREATE TYPE stock_movement_type AS ENUM ('manual_adjustment','sale','refund','restock','waste');
CREATE TYPE review_target_type AS ENUM ('restaurant','driver');
CREATE TYPE review_status AS ENUM ('visible','hidden','flagged');
CREATE TYPE notification_channel AS ENUM ('push','sms','email','in_app','webhook');
CREATE TYPE notification_status AS ENUM ('queued','sent','delivered','failed','read');
CREATE TYPE shift_status AS ENUM ('scheduled','started','ended','cancelled');
CREATE TYPE tax_scope_type AS ENUM ('platform','restaurant','zone');
CREATE TYPE webhook_status AS ENUM ('active','paused','disabled');
CREATE TYPE fraud_case_status AS ENUM ('open','under_review','cleared','confirmed');
CREATE TYPE cart_status AS ENUM ('active','converted','abandoned','expired');

CREATE TABLE restaurant_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_location_id uuid NOT NULL REFERENCES restaurant_locations(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX restaurant_closures_location_idx
  ON restaurant_closures(restaurant_location_id, starts_at, ends_at);

CREATE TABLE tax_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  scope_type tax_scope_type NOT NULL DEFAULT 'platform',
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE,
  delivery_zone_id uuid REFERENCES delivery_zones(id) ON DELETE CASCADE,
  rate_percent numeric(8,4) NOT NULL CHECK (rate_percent >= 0),
  applies_to_subtotal boolean NOT NULL DEFAULT true,
  applies_to_delivery_fee boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX tax_rules_scope_idx ON tax_rules(scope_type, is_active);

CREATE TRIGGER trg_tax_rules_set_updated_at
BEFORE UPDATE ON tax_rules
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE,
  restaurant_location_id uuid REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  delivery_address_id uuid REFERENCES user_addresses(id) ON DELETE SET NULL,
  status cart_status NOT NULL DEFAULT 'active',
  currency text NOT NULL DEFAULT 'ZAR',
  subtotal_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (subtotal_amount >= 0),
  discount_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  delivery_fee_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (delivery_fee_amount >= 0),
  tax_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  coupon_id uuid REFERENCES coupons(id) ON DELETE SET NULL,
  expires_at timestamptz,
  converted_order_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX carts_customer_idx ON carts(customer_user_id, status);
CREATE INDEX carts_restaurant_idx ON carts(restaurant_id);

CREATE TRIGGER trg_carts_set_updated_at
BEFORE UPDATE ON carts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(12,2) NOT NULL CHECK (line_total >= 0),
  item_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cart_items_cart_idx ON cart_items(cart_id);

CREATE TRIGGER trg_cart_items_set_updated_at
BEFORE UPDATE ON cart_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE cart_item_selected_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_item_id uuid NOT NULL REFERENCES cart_items(id) ON DELETE CASCADE,
  modifier_group_name text NOT NULL,
  option_name text NOT NULL,
  unit_price_delta numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_price_delta >= 0),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  total_price_delta numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_price_delta >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cart_item_selected_options_item_idx ON cart_item_selected_options(cart_item_id);

ALTER TABLE carts
  ADD CONSTRAINT carts_converted_order_fk
  FOREIGN KEY (converted_order_id) REFERENCES orders(id) ON DELETE SET NULL;

CREATE TABLE restaurant_tablets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  restaurant_location_id uuid REFERENCES restaurant_locations(id) ON DELETE SET NULL,
  device_name text NOT NULL,
  device_identifier text NOT NULL,
  last_seen_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_identifier)
);

CREATE INDEX restaurant_tablets_rest_idx ON restaurant_tablets(restaurant_id);

CREATE TRIGGER trg_restaurant_tablets_set_updated_at
BEFORE UPDATE ON restaurant_tablets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE restaurant_inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  sku text,
  item_name text NOT NULL,
  tracking_mode inventory_tracking_mode NOT NULL DEFAULT 'simple',
  stock_quantity numeric(12,3) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  reorder_threshold numeric(12,3) NOT NULL DEFAULT 0 CHECK (reorder_threshold >= 0),
  unit text,
  is_active boolean NOT NULL DEFAULT true,
  last_counted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX restaurant_inventory_items_rest_idx ON restaurant_inventory_items(restaurant_id);
CREATE INDEX restaurant_inventory_items_menu_idx ON restaurant_inventory_items(menu_item_id);

CREATE TRIGGER trg_restaurant_inventory_items_set_updated_at
BEFORE UPDATE ON restaurant_inventory_items
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES restaurant_inventory_items(id) ON DELETE CASCADE,
  movement_type stock_movement_type NOT NULL,
  quantity_delta numeric(12,3) NOT NULL,
  reference_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  notes text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_movements_item_idx ON inventory_movements(inventory_item_id, created_at DESC);

CREATE TABLE restaurant_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  status review_status NOT NULL DEFAULT 'visible',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX restaurant_reviews_rest_idx ON restaurant_reviews(restaurant_id, created_at DESC);
CREATE INDEX restaurant_reviews_customer_idx ON restaurant_reviews(customer_user_id);

CREATE TRIGGER trg_restaurant_reviews_set_updated_at
BEFORE UPDATE ON restaurant_reviews
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE driver_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
  delivery_id uuid UNIQUE REFERENCES deliveries(id) ON DELETE SET NULL,
  driver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text text,
  status review_status NOT NULL DEFAULT 'visible',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_reviews_driver_idx ON driver_reviews(driver_user_id, created_at DESC);
CREATE INDEX driver_reviews_customer_idx ON driver_reviews(customer_user_id);

CREATE TRIGGER trg_driver_reviews_set_updated_at
BEFORE UPDATE ON driver_reviews
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE loyalty_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('earn','redeem','expire','adjustment')),
  points integer NOT NULL,
  balance_after integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX loyalty_ledger_customer_idx ON loyalty_ledger(customer_user_id, created_at DESC);

CREATE TABLE driver_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES driver_vehicles(id) ON DELETE SET NULL,
  delivery_zone_id uuid REFERENCES delivery_zones(id) ON DELETE SET NULL,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  status shift_status NOT NULL DEFAULT 'scheduled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_shifts_driver_idx ON driver_shifts(driver_user_id, created_at DESC);
CREATE INDEX driver_shifts_zone_idx ON driver_shifts(delivery_zone_id, created_at DESC);

CREATE TRIGGER trg_driver_shifts_set_updated_at
BEFORE UPDATE ON driver_shifts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE surge_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_zone_id uuid REFERENCES delivery_zones(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE,
  name text NOT NULL,
  multiplier numeric(8,4) NOT NULL CHECK (multiplier >= 1.0),
  starts_at timestamptz,
  ends_at timestamptz,
  weather_condition text,
  demand_threshold integer,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX surge_pricing_rules_active_idx ON surge_pricing_rules(is_active);

CREATE TRIGGER trg_surge_pricing_rules_set_updated_at
BEFORE UPDATE ON surge_pricing_rules
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  channel notification_channel NOT NULL,
  subject text,
  body text NOT NULL,
  status notification_status NOT NULL DEFAULT 'queued',
  provider text,
  provider_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  queued_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_status_idx ON notifications(status, created_at DESC);

CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  endpoint_url text NOT NULL,
  secret_key text NOT NULL,
  status webhook_status NOT NULL DEFAULT 'active',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_endpoints_rest_idx ON webhook_endpoints(restaurant_id, status);

CREATE TRIGGER trg_webhook_endpoints_set_updated_at
BEFORE UPDATE ON webhook_endpoints
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_status integer,
  response_body text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  succeeded_at timestamptz,
  next_retry_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0)
);

CREATE INDEX webhook_deliveries_endpoint_idx ON webhook_deliveries(webhook_endpoint_id, attempted_at DESC);

CREATE TABLE fraud_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  delivery_id uuid REFERENCES deliveries(id) ON DELETE SET NULL,
  customer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  flagged_reason text NOT NULL,
  risk_score numeric(5,2) CHECK (risk_score >= 0),
  status fraud_case_status NOT NULL DEFAULT 'open',
  assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fraud_cases_status_idx ON fraud_cases(status, created_at DESC);

CREATE TRIGGER trg_fraud_cases_set_updated_at
BEFORE UPDATE ON fraud_cases
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();



-- ============================================================
-- ORDER COMMUNICATIONS / CHAT / CALLS
-- ============================================================

CREATE TYPE call_status AS ENUM ('requested','ringing','connected','ended','missed','declined','failed');

CREATE TABLE order_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_body text NOT NULL,
  message_type text NOT NULL DEFAULT 'text' CHECK (message_type IN ('text','system')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX order_chat_messages_order_idx ON order_chat_messages(order_id, created_at ASC);
CREATE INDEX order_chat_messages_sender_idx ON order_chat_messages(sender_user_id, created_at DESC);

CREATE TABLE call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  caller_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  callee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status call_status NOT NULL DEFAULT 'requested',
  offer_sdp text,
  answer_sdp text,
  caller_ice_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  callee_ice_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (caller_user_id <> callee_user_id)
);

CREATE INDEX call_sessions_order_idx ON call_sessions(order_id, created_at DESC);
CREATE INDEX call_sessions_users_idx ON call_sessions(caller_user_id, callee_user_id, created_at DESC);
CREATE INDEX call_sessions_status_idx ON call_sessions(status, created_at DESC);

CREATE TRIGGER trg_call_sessions_set_updated_at
BEFORE UPDATE ON call_sessions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE VIEW cart_summary_view AS
SELECT
  c.id,
  c.customer_user_id,
  c.restaurant_id,
  c.status,
  c.currency,
  c.subtotal_amount,
  c.discount_amount,
  c.delivery_fee_amount,
  c.tax_amount,
  c.total_amount,
  COUNT(ci.id) AS item_count,
  c.updated_at
FROM carts c
LEFT JOIN cart_items ci ON ci.cart_id = c.id
GROUP BY
  c.id, c.customer_user_id, c.restaurant_id, c.status, c.currency,
  c.subtotal_amount, c.discount_amount, c.delivery_fee_amount, c.tax_amount,
  c.total_amount, c.updated_at;

CREATE VIEW restaurant_rating_summary_view AS
SELECT
  r.id AS restaurant_id,
  r.display_name,
  COALESCE(AVG(rr.rating)::numeric(4,2), 0) AS average_rating,
  COUNT(rr.id) AS review_count
FROM restaurants r
LEFT JOIN restaurant_reviews rr
  ON rr.restaurant_id = r.id
 AND rr.status = 'visible'
GROUP BY r.id, r.display_name;

CREATE VIEW driver_rating_summary_view AS
SELECT
  u.id AS driver_user_id,
  u.full_name,
  COALESCE(AVG(dr.rating)::numeric(4,2), 0) AS average_rating,
  COUNT(dr.id) AS review_count
FROM users u
LEFT JOIN driver_reviews dr
  ON dr.driver_user_id = u.id
 AND dr.status = 'visible'
GROUP BY u.id, u.full_name;


COMMIT;

-- ============================================================
-- REALTIME / PUSH / COMPLIANCE EXTENSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_token text NOT NULL UNIQUE,
  platform text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_push_tokens_user_idx ON user_push_tokens(user_id, is_active);

CREATE TABLE IF NOT EXISTS driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  document_number text,
  file_url text NOT NULL,
  mime_type text,
  original_name text,
  expires_at timestamptz,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected','expired')),
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_documents_driver_idx ON driver_documents(driver_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restaurant_kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  registration_number text,
  file_url text NOT NULL,
  mime_type text,
  original_name text,
  expires_at timestamptz,
  verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected','expired')),
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS restaurant_kyc_documents_restaurant_idx ON restaurant_kyc_documents(restaurant_id, created_at DESC);
