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

-- Orders from the web app (src/checkout.ts). Only written once sales are open (PROMPTPAY_ID set); until then the checkout is a demo and this table stays empty. Holds a shipping address: personal data.
CREATE TABLE IF NOT EXISTS orders (
  ref            TEXT PRIMARY KEY,   -- AJ-XXXXXX (BS- before the fish shop), shown to the customer
  user_id        TEXT NOT NULL,
  lines          TEXT NOT NULL,      -- JSON [{product, variant, qty}]
  total          INTEGER NOT NULL,   -- THB the customer pays for products (subtotal - discount)
  ship_name      TEXT NOT NULL,
  ship_phone     TEXT NOT NULL,
  ship_address   TEXT NOT NULL,
  ship_postcode  TEXT NOT NULL,
  status         TEXT NOT NULL,      -- awaiting_payment | paid | shipped | cancelled (staff update it)
  created_at     INTEGER NOT NULL,
  subtotal       INTEGER NOT NULL DEFAULT 0,  -- THB before the points discount (migrations/0003)
  discount       INTEGER NOT NULL DEFAULT 0,  -- THB taken off by a points redemption
  points_used    INTEGER NOT NULL DEFAULT 0,  -- points spent (ledger row 'redeem:<ref>'; back if cancelled)
  stock_held     INTEGER NOT NULL DEFAULT 0   -- 1 while this order holds product stock; a cancel returns it once
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);

-- Fish (products) for sale, managed by staff in the dashboard (src/products.ts). Each betta is usually one of a
-- kind, so stock is usually 1; a paid order keeps it taken, a cancelled order gives it back.
CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,               -- short code used in orders, e.g. red_dragon
  name        TEXT NOT NULL,
  size        TEXT NOT NULL DEFAULT '',      -- short line under the name, e.g. sex and fin type
  price       INTEGER NOT NULL,               -- THB
  blurb       TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT '#2e6fa7',
  image       TEXT NOT NULL DEFAULT '',      -- /img/... (bundled) or /pimg/<id>?v=<n> (uploaded, product_images)
  detail      TEXT NOT NULL DEFAULT '{}',    -- JSON {number, tagline, smells, feel, suits[], when}
  stock       INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'active', -- active | hidden
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Photos uploaded in the dashboard (resized in the browser), served at /pimg/<id>.
CREATE TABLE IF NOT EXISTS product_images (
  id          TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  data        TEXT NOT NULL,                  -- base64
  updated_at  INTEGER NOT NULL
);

-- The five starter fish (prices are examples, edit them in the dashboard).
INSERT OR IGNORE INTO products (id, name, size, price, blurb, color, image, detail, stock, status, sort, created_at, updated_at) VALUES
  ('red_dragon', 'Red Dragon Halfmoon', 'ตัวผู้ · Halfmoon หางยาว', 450, 'หางยาวกางเต็มครึ่งวงกลม ตัวแดงเงาเกล็ดมังกร เหมาะเป็นปลาโชว์บนโต๊ะ', '#c0392b', '/img/red_dragon.jpg', '{"number":"BF-001","tagline":"ปลาโชว์หางพลิ้ว สายประกวด","smells":"หางยาวแบบ Halfmoon กางได้ 180 องศาเวลาพองตัว ลำตัวแดงเข้มมีเกล็ดเงาแบบเกล็ดมังกร","feel":"สง่า โดดเด่น เป็นจุดสนใจของมุมที่วาง","suits":["คนที่ชอบปลาหางยาวสวยแบบปลาประกวด","คนที่อยากได้ปลาตัวเดียวเป็นจุดเด่นบนโต๊ะหรือชั้นวาง","คนที่ดูแลตู้ได้สม่ำเสมอ"],"when":"ใช้ตู้ 5 ลิตรขึ้นไป น้ำไหลเบาๆ ไม่ใส่ของตกแต่งคม เพราะหางยาวขาดง่าย"}', 1, 'active', 10, 0, 0),
  ('blue_rim', 'Blue Rim Plakat', 'ตัวผู้ · Plakat หางสั้น', 350, 'หางสั้น ว่ายไว ขอบครีบสีฟ้า แข็งแรง เหมาะกับคนเพิ่งเริ่มเลี้ยง', '#2e6fa7', '', '{"number":"BF-002","tagline":"ปลากัดตัวแรกที่เลี้ยงง่าย","smells":"ปลากัดหางสั้น (Plakat) ว่ายเร็ว ขอบครีบสีฟ้าตัดกับลำตัว","feel":"ปราดเปรียว มีนิสัย ชอบว่ายมาทักคนเลี้ยง","suits":["คนที่เพิ่งเริ่มเลี้ยงปลากัดตัวแรก","คนที่ชอบปลาว่ายไว แอคทีฟ","คนที่ยังไม่มีตู้ (ซื้อพร้อมชุดเริ่มต้นได้)"],"when":"ตู้ 5 ลิตรขึ้นไป เปลี่ยนน้ำทุกสัปดาห์"}', 1, 'active', 20, 0, 0),
  ('black_samurai', 'Black Samurai', 'ตัวผู้ · Plakat หางสั้น', 590, 'ตัวดำสนิท เกล็ดขอบเงินเหมือนชุดเกราะซามูไร ดุดัน สายสะสม', '#2b2b2b', '', '{"number":"BF-003","tagline":"เกราะดำขอบเงิน","smells":"ปลากัดหางสั้น ลำตัวดำเข้ม เกล็ดมีขอบสีเงินเรียงเหมือนชุดเกราะ","feel":"เข้ม ดุดัน ดูมีราคา","suits":["คนที่ชอบปลาสีเข้ม ดูดุ","นักสะสมที่อยากได้ลายหายาก","คนที่มีตู้พร้อมแล้ว"],"when":"ตู้ 5 ลิตรขึ้นไป พื้นหลังสีอ่อนจะทำให้ลายเกล็ดเด่นขึ้น"}', 1, 'active', 30, 0, 0),
  ('galaxy_koi', 'Galaxy Koi', 'ตัวเมีย · HMPK', 250, 'ตัวเมียลายคาร์ปมีจุดประกายแบบกาแล็กซี่ ตัวเล็ก สีสวย วางโต๊ะทำงานได้', '#e08a4c', '', '{"number":"BF-004","tagline":"ลายคาร์ปจุดประกาย","smells":"ปลากัดตัวเมียแบบ Halfmoon Plakat ลายคล้ายปลาคาร์ป มีจุดเล็กๆ ระยิบระยับทั่วตัว","feel":"น่ารัก สดใส ดูเพลินบนโต๊ะทำงาน","suits":["คนที่อยากได้ปลาตัวเล็กสีสวยไว้บนโต๊ะ","คนที่ชอบลายคาร์ป","คนที่อยากเริ่มเลี้ยงแบบไม่ต้องดูแลหางยาว"],"when":"ตัวเมียก็กัดกันได้ คนเพิ่งเริ่มควรเลี้ยงตู้ละตัว"}', 1, 'active', 40, 0, 0),
  ('nemo_candy', 'Nemo Candy', 'ตัวผู้ · Plakat หางสั้น', 390, 'สีส้ม แดง ดำ ขาว เป็นแต้มๆ เหมือนปลาการ์ตูนหรือลูกอม สีไม่ซ้ำใคร', '#f39c12', '', '{"number":"BF-005","tagline":"ลูกอมหลากสี","smells":"ปลากัดหางสั้น มีแต้มสีส้ม แดง ดำ และขาวทั่วตัว ลายของแต่ละตัวไม่ซ้ำกัน","feel":"สนุก สีสันจัด ดูแล้วอารมณ์ดี","suits":["คนที่ชอบสีแปลกและลายไม่ซ้ำใคร","คนที่อยากได้ปลาสีสดใส","คนที่ชอบถ่ายรูปปลาลงโซเชียล"],"when":"ตู้ 5 ลิตรขึ้นไป สีจะสดเมื่อน้ำสะอาดและอาหารดี"}', 1, 'active', 50, 0, 0);
