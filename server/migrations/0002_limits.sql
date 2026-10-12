-- 満月米 API: per-client request limits, and a "last checked at Stripe" time for pending orders

-- Requests per client address (an IPv6 client is counted per /64) in a fixed window,
-- e.g. key 'checkout:203.0.113.7'. Old rows are deleted by the cron sweep.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- When the cron sweep last asked Stripe about a pending order. The sweep takes the orders it
-- has not checked yet (or checked longest ago) first, so orders that keep failing cannot
-- block the rest.
ALTER TABLE orders ADD COLUMN checked_at TEXT;
