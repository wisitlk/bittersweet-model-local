# The LINE web app (catalog + points)

A page that opens inside LINE (a **LIFF app**, "LINE Front-end Framework"). Customers see the three scents and the
discovery set with real prices, can join the **pre-order waitlist** (no payment, no address: we are not selling until
the Thai FDA notification), and see their points. LINE Login is built in: inside the LINE app the customer is logged in
automatically; in a normal browser they tap "เข้าสู่ระบบด้วย LINE".

```
LINE app ──opens──▶ https://<worker>/app ──API calls with the LINE ID token──▶ /api/me, /api/waitlist ──▶ D1
                                                         └─ the Worker checks the token with LINE first
```

## Points (defaults, change in `src/catalog.ts`)

| Reason | Points | Given when |
|---|---|---|
| Added the bot as a friend | +10 | the customer opens the page and LINE confirms the friendship |
| PDPA consent | +20 | consent given in the chat or on the page |
| Joined the waitlist | +30 | first waitlist sign-up (once, not per scent; the button is gone once selling) |
| Sign-up / survey | +50 / +30 | see below |
| Purchase | 1 per 10 THB | staff set the order to `paid` (`BAHT_PER_POINT` in `src/loyalty.ts`) |

Each reason counts once per customer. **Redeem at checkout** (`REDEEM_OPTIONS` in `src/checkout.ts`), one per order,
on the products total: 50 points = 20% off, 200 points = 50% off. The points are spent in the same D1 transaction that
saves the order (ledger row `redeem:<ref>`), so they can never go below zero or be spent twice. Purchase points and
refunds are worked out from the order status, so staff only change the status:

```
npx wrangler d1 execute bitter_sweet --remote --command "UPDATE orders SET status='paid' WHERE ref='BS-XXXXXX'"
npx wrangler d1 execute bitter_sweet --remote --command "UPDATE orders SET status='cancelled' WHERE ref='BS-XXXXXX'"
```

`paid` (or `shipped`) adds the purchase points; `cancelled` gives back the points used on that order.
Typing "ลบข้อมูล" in the chat deletes points and waitlist too. Points and waitlist rows are not removed by the 7-day
cleanup, because they are the record the customer expects to keep.

## Setup (about 15 minutes, free)

1. **Create the tables.** In the project folder:
   ```
   npx wrangler d1 execute bitter_sweet --remote --file=schema.sql
   ```
   Safe to run again: existing tables are kept.
2. **Create a LINE Login channel.** LINE Developers console → open the **same Provider** as the bot (otherwise the
   customer gets a different user ID and points don't match the chat) → *Create a new channel* → **LINE Login**.
   App type: **Web app**. Region: Thailand.
3. In that channel's **Basic settings**: copy the **Channel ID** (a number, not a secret). Under *Linked LINE Official
   Account* pick the bot's account.
4. **LIFF** tab → *Add*:
   - LIFF app name: `BitterSweet`
   - Size: **Full**
   - Endpoint URL: `https://bittersweet-line-concierge.bittersweet-line-concierge.workers.dev/app`
   - Scopes: tick **openid** and **profile**
   - Add friend option: **On (normal)**
   Save, then copy the **LIFF ID** (looks like `2001234567-AbCdEfGh`, not a secret).
5. At the top of the channel, switch **Developing → Published**. While it says Developing, only you can log in.
6. In `wrangler.toml` → `[vars]` fill in:
   ```
   LIFF_ID = "<LIFF ID>"
   LINE_LOGIN_CHANNEL_ID = "<Channel ID>"
   ```
   then `npm run deploy`.
7. **Test:** open `https://liff.line.me/<LIFF ID>` on your phone (send it to yourself in LINE and tap it).
8. **Rich menu** (optional): LINE Official Account Manager → Rich menus → add a button with link
   `https://liff.line.me/<LIFF ID>` (catalog) and one with `https://liff.line.me/<LIFF ID>?tab=points` (points).

## Scent pages (links for the product sheet PDF)

`https://liff.line.me/<LIFF ID>?scent=<id>` opens one scent's page (photo, tagline, notes, feel, who it suits, when to
wear it, price). Anyone can read it without logging in or signing up; the buy button asks for LINE Login and sign-up
first. The text lives in `src/catalog.ts` (`detail`), copied from product sheet V0.0.6. The ids are `slow_morning`,
`self_toast`, `long_bath`, `stay_in`, `tea_break` (a hyphen also works, e.g. `?scent=long-bath`). In the shop, each
card's "ดูรายละเอียดกลิ่น" link opens the same page.

## Photos

`public/img/` holds the pictures (`hero.jpg` at the top, one per scent, cropped from product sheet V0.0.6). Replace a
file with the same name and deploy. Cloudflare serves these files directly; they do not use the Worker's limits.

## When something goes wrong

`npx wrangler tail`:

| What you see | Meaning | Fix |
|---|---|---|
| page says "Web app not configured" | `LIFF_ID` empty | step 6 |
| `liff_not_configured` | `LINE_LOGIN_CHANNEL_ID` empty | step 6 |
| `liff_verify_failed 400` | token from another channel, or expired | check the Channel ID is the LINE Login channel's, not the bot's |
| page "เปิดหน้าเว็บไม่สำเร็จ" | LIFF ID wrong, or endpoint URL does not match | steps 4 and 6 |
| `D1_ERROR: no such table: points` | step 1 not done | step 1 |
| no friend points | the customer has not added the bot, or step 3's link is missing | add the bot as a friend, reopen the page |

## Sign-up, survey and checkout (2026-10-31)

- **Sign-up** (`/api/register`, `src/member.ts`): after LINE Login a new customer gives first name, last name,
  phone and age, ticks the PDPA box (and a guardian box under 20). +50 points. Stored in D1 `members` only;
  never logged or sent to the Sheet.
- **Survey** (`/api/survey`, `src/survey.ts`): 6 questions from `scent-concierge/sample-data/SURVEY.md`, members
  only. Shows the personality type and its scent (+30 points), sends answer codes (no names) to the Sheet, and the
  chat bot gets a short note about it before each message.
- **Checkout** (`/api/checkout`, `src/checkout.ts`): product -> Bottle or Sample and quantity -> shipping address ->
  points discount -> PromptPay page. **A demo until both secrets are set** (nothing stored, no QR). To open sales:
  `npx wrangler secret put FDA_NOTIFICATION_NO` and `npx wrangler secret put PROMPTPAY_ID` (the shop's PromptPay
  phone or 13-digit tax id; secrets, so it stays out of this public repo), run `migrations/0003_order_redeem.sql`
  on an existing database, and deploy. The bot text (`content/`) already says the shop is open and sends buyers to
  `?tab=shop`. Orders land in D1 `orders` with status `awaiting_payment`; staff check the slip in the LINE chat and
  update the status (commands above).
  A buyer's deletion request goes to staff (paid orders may have to be kept for tax).
- New tables for an existing database: `npx wrangler d1 execute bitter_sweet --remote --file migrations/0002_surveys_members.sql`.
