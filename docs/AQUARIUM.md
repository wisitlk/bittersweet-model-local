# Aquatic Jewel: LINE OA betta shop (this branch)

This branch turns the BitterSweet perfume bot into **Aquatic Jewel**, a Thai betta fish (ปลากัด) shop on its own
LINE Official Account. Same architecture: a Cloudflare Worker answers the LINE chat with Gemini (structured JSON),
and the LINE web app (LIFF) has sign-up, a fish-keeper survey, points, the shop with PromptPay checkout and the staff
dashboard. It deploys as a **new Worker** (`aquatic-jewel-line`) with a **new D1 database** (`aquatic_jewel`), so it
shares nothing with the old BitterSweet Worker.

Content sources: the shop's web projects `wisitlk/betta-fish-web` and `wisitlk/fish-store-betta` (shop name, the five
demo fish, live-arrival guarantee, WYSIWYG listings).

## What changed from BitterSweet

| Area | Where | Now |
|---|---|---|
| Bot persona and rules | `content/system_prompt.md` | Betta Concierge: honest fish keeper, animal welfare first, sick fish → staff |
| Knowledge | `content/knowledge.md` | Shop, 5 fish, starter kit, basic betta care, FAQ |
| Greeting | `content/greeting_th.txt` | Aquatic Jewel welcome + PDPA note |
| Catalog | `src/catalog.ts` | 5 fish, each with its own price; `KIT_PRICE` for the starter kit |
| Checkout | `src/checkout.ts` | Price = fish price + variant extra (`bottle` = fish only, `sample` = fish + kit; keys kept for the orders table). Sales open with `PROMPTPAY_ID` alone (no FDA number for live fish) |
| Survey | `src/survey.ts` | Place, tank, fins, keeper type (→ segment + fish), experience, buy intent |
| CRM segments | `src/claude.ts`, `apps_script/Code.gs` | first_timer, show_lover, bold_collector, desk_keeper, color_hunter, kit_buyer, gift_seeker, repeat_keeper |
| Web app / dashboard | `web/app.html`, `web/admin.html` | Aquatic Jewel name, blue theme, fish wording; order refs start `AJ-` |
| Worker / DB | `wrangler.toml` | `aquatic-jewel-line`, D1 `aquatic_jewel`, LIFF ids empty until the new channel exists |

CRM column names (`scents_smelled`, `sample_interest`) are unchanged so the Sheet and Apps Script stay compatible;
for the fish shop they mean "fish looked at" and "wants the starter kit".

**Placeholders to confirm:** the THB prices of the five fish and the starter kit (390 THB) are examples. Change them
in `content/knowledge.md`, `src/catalog.ts` (and the test `catalog prices match the knowledge base`) together.

## Deploy (owner, on the Mac)

1. **LINE Official Account.** In LINE Official Account Manager create a new account "Aquatic Jewel", then Settings →
   Messaging API → Enable (pick or create a provider). In LINE Developers, open that Messaging API channel:
   copy nothing into any chat; you will paste the **Channel secret** and a long-lived **Channel access token** at the
   hidden prompts in step 6. In OA Manager → Response settings: chat off, webhooks on, auto-response off.
2. **LINE Login channel for the web app**, under the **same provider** (LINE user ids differ between providers, so
   points and admin ids only match inside one provider). Add a LIFF app: size Full, scopes `openid` + `profile`,
   endpoint `https://aquatic-jewel-line.<your-workers-subdomain>.workers.dev/app`. Put its LIFF id and the Login
   channel id into `wrangler.toml` (`LIFF_ID`, `LINE_LOGIN_CHANNEL_ID`; not secrets).
3. **Database.** `npx wrangler d1 create aquatic_jewel`, paste the printed `database_id` into `wrangler.toml`, then
   `npx wrangler d1 execute aquatic_jewel --remote --file=schema.sql`.
4. **Check.** `npm ci && npm run typecheck && npm test && npm run lint`.
5. **Deploy.** `npx wrangler deploy` (prints the Worker URL).
6. **Secrets** (each asks at a hidden prompt):
   `npx wrangler secret put LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `GEMINI_API_KEY`;
   later `ADMIN_LINE_USER_IDS` (your LINE user id for this provider), and `PROMPTPAY_ID` only when you want real sales.
7. **Webhook.** LINE Developers → Messaging API → Webhook URL
   `https://aquatic-jewel-line.<your-workers-subdomain>.workers.dev/webhook` → Verify → Use webhook on.
8. **Rich menu** (OA Manager): a button that opens `https://liff.line.me/<LIFF_ID>`.

Optional: Google Sheet CRM (SETUP.md step 6, with this branch's `apps_script/Code.gs`) and the Mac mini model
(`docs/MAC-MINI.md`); without them the bot runs on Gemini only and skips the Sheet.
