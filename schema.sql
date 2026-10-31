-- D1 schema for the BitterSweet concierge. Safe to run more than once.
-- All timestamps are unix milliseconds.

-- Webhook idempotency: one row per LINE webhookEventId already handled.
CREATE TABLE IF NOT EXISTS processed_events (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL
);

-- Conversation history: two rows per turn (role 'user', then role 'assistant').
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages (user_id, created_at);

-- Rate limit and daily-cap counters. A row is a fixed window that ends at expires_at.
CREATE TABLE IF NOT EXISTS counters (
  key         TEXT PRIMARY KEY,
  count       INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- PDPA consent already given by a user (remembered because history keeps only reply text).
-- Deleted when the user asks to delete their data; old rows are removed by the daily cleanup.
CREATE TABLE IF NOT EXISTS consents (
  user_id     TEXT PRIMARY KEY,
  given       INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Loyalty points from the LINE web app (LIFF). One row per reason per user, so an award can never be counted twice.
-- Kept past the 7-day cleanup (it is the points record); deleted when the user asks to delete their data.
CREATE TABLE IF NOT EXISTS points (
  user_id     TEXT NOT NULL,
  reason      TEXT NOT NULL,
  amount      INTEGER NOT NULL,   -- named "amount" in the live database bitter_sweet (created 2026-10-27)
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, reason)
);

-- Pre-order waitlist joined from the web app, always with PDPA consent (no orders, no payments, no addresses).
-- Kept until sales open; deleted when the user asks to delete their data.
CREATE TABLE IF NOT EXISTS waitlist (
  user_id     TEXT NOT NULL,
  product     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, product)
);

-- Scent survey from the web app (src/survey.ts), members only (consent given at sign-up).
-- Kept past the 7-day cleanup (it is what the segments are built from); deleted when the user asks to delete their data.
CREATE TABLE IF NOT EXISTS surveys (
  user_id           TEXT PRIMARY KEY,
  age_group         TEXT NOT NULL,      -- 14-22 | 23-30 | 31-40 | 41+ (from the member's age)
  under_20          INTEGER NOT NULL,
  guardian_consent  INTEGER NOT NULL,
  answers           TEXT NOT NULL,      -- JSON of answer codes (q1..q6), never free text
  personality       TEXT NOT NULL,      -- q4 code, see PERSONALITY in src/survey.ts
  updated_at        INTEGER NOT NULL
);

-- Members who signed up in the web app (src/member.ts): personal data, so only with PDPA consent (and a
-- guardian's under 20). Never logged or sent to the Sheet; deleted when the user asks to delete their data.
CREATE TABLE IF NOT EXISTS members (
  user_id           TEXT PRIMARY KEY,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  phone             TEXT NOT NULL,
  age               INTEGER NOT NULL,
  guardian_consent  INTEGER NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

-- Orders from the web app (src/checkout.ts). Only written once sales are open (FDA_NOTIFICATION_NO and PROMPTPAY_ID
-- set); until then the checkout is a demo and this table stays empty. Holds a shipping address: personal data.
CREATE TABLE IF NOT EXISTS orders (
  ref            TEXT PRIMARY KEY,   -- BS-XXXXXX, shown to the customer
  user_id        TEXT NOT NULL,
  lines          TEXT NOT NULL,      -- JSON [{product, variant, qty}]
  total          INTEGER NOT NULL,   -- THB, products only
  ship_name      TEXT NOT NULL,
  ship_phone     TEXT NOT NULL,
  ship_address   TEXT NOT NULL,
  ship_postcode  TEXT NOT NULL,
  status         TEXT NOT NULL,      -- awaiting_payment | paid | shipped | cancelled (staff update it)
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
