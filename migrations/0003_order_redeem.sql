-- Points redemption on orders (src/checkout.ts). Adds columns only; existing rows get 0.
-- Only for a database made before this change (schema.sql already has these columns). Run once:
-- npx wrangler d1 execute bitter_sweet --remote --file=migrations/0003_order_redeem.sql
ALTER TABLE orders ADD COLUMN subtotal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN points_used INTEGER NOT NULL DEFAULT 0;
