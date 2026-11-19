# Aquatic Jewel: LINE OA betta shop (this branch)

This branch turns the BitterSweet perfume bot into **Aquatic Jewel**, a Thai betta fish (ปลากัด) shop on its own
LINE Official Account. Same architecture: a Cloudflare Worker answers the LINE chat with Gemini (structured JSON),
and the LINE web app (LIFF) has sign-up, a fish-keeper survey, points, the shop with PromptPay checkout and the staff
dashboard. Decided 2026-11-19: it **reuses the BitterSweet LINE OA** (renamed later by the owner), so it deploys over
the same Worker (`bittersweet-line-concierge`), D1 database (`bitter_sweet`), LIFF app and Worker secrets.

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
| Worker / DB | `wrangler.toml` | Unchanged: same Worker, D1, LIFF and webhook URL as BitterSweet |

CRM column names (`scents_smelled`, `sample_interest`) are unchanged so the Sheet and Apps Script stay compatible;
for the fish shop they mean "fish looked at" and "wants the starter kit".

**Placeholders to confirm:** the THB prices of the five fish and the starter kit (390 THB) are examples. Change them
in `content/knowledge.md`, `src/catalog.ts` (and the test `catalog prices match the knowledge base`) together.

## Deploy (owner, on the Mac mini)

Same OA, Worker, database and secrets as before, so no LINE or database setup is needed:

1. In the repo folder: `git fetch origin claude/project-thread-rx82e5 && git checkout claude/project-thread-rx82e5`
   (or merge PR #4 first and use that branch).
2. `npm ci && npm run typecheck && npm test && npm run lint`.
3. `npx wrangler deploy` (add the usual `--var LLM_PROVIDER:hybrid --var LLM_BASE_URL:<tunnel>` only if Gemma on the
   Mac mini is running; otherwise the bot uses Gemini).
4. In LINE Official Account Manager, rename the account and change its profile picture and greeting when ready;
   the bot's own greeting text is `content/greeting_th.txt`.

Existing data stays: old BitterSweet surveys are ignored (unknown types), old orders and waitlist rows show their old
product ids in the dashboard, and members keep their points. The secret `FDA_NOTIFICATION_NO` is no longer read.

### Separate OA later
To run the fish shop on its own OA instead, change `name`, the D1 block and the two LIFF ids in `wrangler.toml`,
create the database with `npx wrangler d1 create <name>` + `npx wrangler d1 execute <name> --remote --file=schema.sql`,
set `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` and `GEMINI_API_KEY` as secrets, and point the new channel's
webhook at `<worker url>/webhook`. Keep the LINE Login channel under the same provider as the Messaging API channel.
