-- Fish shop: products managed in the dashboard, stock held by orders. For a database made before this change
-- (schema.sql already has all of it). Run once:
-- npx wrangler d1 execute bitter_sweet --remote --file=migrations/0004_products.sql
ALTER TABLE orders ADD COLUMN stock_held INTEGER NOT NULL DEFAULT 0;

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
