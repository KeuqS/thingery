-- Thingery Item Graph schema v0.1
-- Requires Postgres with pgvector (image: pgvector/pgvector:pg16)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS sellers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key      TEXT UNIQUE NOT NULL,          -- format: thg_<random>; store hashed in production
  display_name TEXT NOT NULL,
  profile      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- flexible per-seller fields: locale, currency,
                                                    -- notification prefs, negotiation mandates, ...
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Account system (chat/signup, v0.2). Idempotent ALTERs: safe on existing databases.
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS email TEXT UNIQUE;
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Category registry: declares the expected attribute fields per category so
-- agents can self-serve the schema (describe_category tool). Items are NOT
-- locked to these definitions — unknown attribute keys pass through, which
-- keeps the graph flexible and federation-friendly.
CREATE TABLE IF NOT EXISTS categories (
  name                 TEXT PRIMARY KEY,      -- lowercase slug, e.g. 'sneakers'
  description          TEXT NOT NULL DEFAULT '',
  attribute_definitions JSONB NOT NULL DEFAULT '[]',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id     UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL DEFAULT 'other',
  condition     TEXT NOT NULL DEFAULT 'good'
                CHECK (condition IN ('new','like_new','good','fair','poor')),
  brand         TEXT,
  price_cents   INTEGER NOT NULL CHECK (price_cents >= 0),
  currency      CHAR(3) NOT NULL DEFAULT 'EUR',
  location      TEXT,
  weight_grams  INTEGER,
  dimensions_mm TEXT,                          -- "300x200x150" (LxWxH), for shipping estimation
  shipping_tier TEXT NOT NULL DEFAULT 'unknown'
                CHECK (shipping_tier IN ('locker','parcel','bulky','local','unknown')),
  images        TEXT[] NOT NULL DEFAULT '{}',
  attributes    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- category-specific fields (size, colorway,
                                                     -- ISBN, shutter_count, ...) — free-form
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','reserved','sold','deleted')),
  embedding     vector(1536),                  -- text-embedding-3-small by default
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_status_created_idx ON items (status, created_at DESC);
CREATE INDEX IF NOT EXISTS items_seller_idx ON items (seller_id);
CREATE INDEX IF NOT EXISTS items_category_idx ON items (category);
CREATE INDEX IF NOT EXISTS items_price_idx ON items (price_cents);
CREATE INDEX IF NOT EXISTS items_attributes_idx ON items USING gin (attributes jsonb_path_ops);

INSERT INTO categories (name, description, attribute_definitions) VALUES
  ('sneakers', 'Trainers and sneakers',
   '[{"key":"size_eu","type":"number","required":true,"description":"EU shoe size, e.g. 43"},
     {"key":"colorway","type":"string","description":"e.g. white/grey"},
     {"key":"has_original_box","type":"boolean"}]'),
  ('shoes', 'Non-sneaker footwear',
   '[{"key":"size_eu","type":"number","required":true,"description":"EU shoe size"},
     {"key":"material","type":"string"}]'),
  ('clothing', 'Clothes and accessories',
   '[{"key":"size","type":"string","required":true,"description":"e.g. M, 42, One Size"},
     {"key":"material","type":"string"},
     {"key":"color","type":"string"}]'),
  ('electronics', 'Consumer electronics',
   '[{"key":"model","type":"string","description":"Model name/number"},
     {"key":"warranty_months","type":"number"}]'),
  ('phones', 'Mobile phones',
   '[{"key":"model","type":"string","required":true},
     {"key":"storage_gb","type":"number"},
     {"key":"battery_health_pct","type":"number"}]'),
  ('computers', 'Laptops and desktops',
   '[{"key":"model","type":"string","required":true},
     {"key":"ram_gb","type":"number"},
     {"key":"storage_gb","type":"number"}]'),
  ('games', 'Video games and consoles',
   '[{"key":"platform","type":"string","enum":["nintendo_switch","ps4","ps5","xbox_one","xbox_series","pc","other"],"required":true}]'),
  ('books', 'Books and magazines',
   '[{"key":"author","type":"string"},
     {"key":"isbn","type":"string"},
     {"key":"language","type":"string"}]'),
  ('music', 'Instruments, vinyl, CDs',
   '[{"key":"format","type":"string","enum":["vinyl","cd","cassette","instrument","other"]},
     {"key":"artist","type":"string"}]'),
  ('sports', 'Sports and outdoor gear',
   '[{"key":"sport","type":"string"}]'),
  ('home', 'Furniture and household',
   '[{"key":"material","type":"string"},
     {"key":"color","type":"string"}]'),
  ('toys', 'Toys and games',
   '[{"key":"age_range","type":"string","description":"e.g. 6+, 12+"}]'),
  ('collectibles', 'Collectibles and memorabilia',
   '[{"key":"franchise","type":"string"}]'),
  ('other', 'Everything else', '[]')
ON CONFLICT (name) DO NOTHING;

-- Approximate nearest neighbour index; safe to create before rows exist
CREATE INDEX IF NOT EXISTS items_embedding_idx
  ON items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS items_set_updated_at ON items;
CREATE TRIGGER items_set_updated_at BEFORE UPDATE ON items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- MCP OAuth one-click onboarding (spec THI-11 rev 2, §3).
-- Dynamic clients (RFC 7591), grants, hashed tokens, hashed authorization codes.
-- All additive and idempotent (expand-only migration); no columns are added to
-- sellers — OAuth state hangs off seller_id FKs and cascades on seller delete.
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id     TEXT PRIMARY KEY,            -- 'thgc_...' random; public identifier
  client_name   TEXT,                        -- from DCR, e.g. 'Claude Desktop'; data, not HTML
  client_uri    TEXT,                        -- from DCR; stored as data, never rendered as a link
  redirect_uris TEXT[] NOT NULL,             -- exact-match list; loopback http allowed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorized_at TIMESTAMPTZ                  -- set on first code issuance; NULL + old → sweep
);

CREATE TABLE IF NOT EXISTS oauth_grants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id   UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  scope       TEXT NOT NULL DEFAULT 'mcp',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ                    -- family-revocation flag; one row per "Allow" click
);
CREATE INDEX IF NOT EXISTS oauth_grants_seller_idx ON oauth_grants (seller_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id     UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('access','refresh')),
  token_hash   TEXT UNIQUE NOT NULL,         -- sha256 hex of the full 'thgo_...'/'thgr_...' string
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ                   -- throttled update (>= 10 min granularity)
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant_idx ON oauth_tokens (grant_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_sweep_idx ON oauth_tokens (kind, expires_at);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash       TEXT PRIMARY KEY,          -- sha256 hex of the full 'thga_...' string
  grant_id        UUID NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  seller_id       UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,              -- bound at issuance (normalized form)
  code_challenge  TEXT NOT NULL,              -- PKCE S256 digest, bound at issuance
  resource        TEXT,                        -- RFC 8707 audience, bound at issuance when sent
  scope           TEXT NOT NULL DEFAULT 'mcp',
  expires_at      TIMESTAMPTZ NOT NULL,       -- now() + 60s
  consumed_at     TIMESTAMPTZ,                -- single-use flag; replay detection
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
