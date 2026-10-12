-- 満月米 API: the client an order's held stock belongs to, and finding the same order placed twice

-- client_key: HMAC-SHA256 of the client address (IPv4, or the IPv6 /64) with a server secret
-- (HOLD_SALT, else ADMIN_TOKEN), so the address itself is never stored. With HOLD_PER_CLIENT set,
-- one client may hold at most that many units of a variant in pending orders (no cap by default).
-- The cron sweep clears it after a day.
ALTER TABLE orders ADD COLUMN client_key TEXT;

-- dup_key: SHA-256 of the e-mail address (lower case), the items (product, kind, number) and the
-- delivery address. The same shopper in two browsers gets the same key: the older checkout is
-- closed before a new one is made, and a recent payment for it is pointed out.
ALTER TABLE orders ADD COLUMN dup_key TEXT;

CREATE INDEX IF NOT EXISTS orders_by_client ON orders (client_key, created_at);
CREATE INDEX IF NOT EXISTS orders_by_dup ON orders (dup_key, created_at);
