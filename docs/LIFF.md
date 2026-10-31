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
| Joined the waitlist | +30 | first waitlist sign-up (once, not per scent) |

Each reason counts once per customer. How points are used is "announced when sales open": the brand has not decided.
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
