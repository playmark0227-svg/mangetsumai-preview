-- 満月米 API: initial schema (Cloudflare D1 / SQLite)

-- The product catalog is one JSON document (the same shape as js/core.js DEFAULT_CATALOG).
-- rev is bumped on every write; writers use "WHERE rev = ?" for optimistic concurrency.
-- stamp is a random value written together with rev, so a statement in the same batch can
-- tell whether *its* catalog update was the one that went through.
CREATE TABLE IF NOT EXISTS catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  stamp TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- One row per order. data holds the full order record (JSON); the columns below are the
-- source of truth for no / created_at / payment / status / session id.
CREATE TABLE IF NOT EXISTS orders (
  no TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  payment TEXT NOT NULL DEFAULT 'pending' CHECK (payment IN ('pending', 'paid', 'expired')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'preparing', 'shipped', 'canceled')),
  session_id TEXT UNIQUE,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_by_payment ON orders (payment, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_by_created ON orders (created_at DESC);

-- Failed admin logins per client address (simple lock-out against password guessing).
CREATE TABLE IF NOT EXISTS admin_failures (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);
