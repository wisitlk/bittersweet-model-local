# Setup guide (for a non-programmer)

Goal: students scan a QR code, add your LINE Official Account, and chat with the BitterSweet Scent Concierge in Thai.

Total time: about 1.5 to 2 hours the first time. Do the steps in order. Use a **separate test LINE Official Account** first, not your real brand account.

You will copy a few secret values (keys). Keep them in a private note. Never paste them into chat, email or Git.

---

## 0. What you need installed (10 min)

- **Node.js** (version 20 or newer). Check in a terminal: `node -v`. If it fails, install the LTS version from nodejs.org.
- This folder (`cf-line-demo`) open in a terminal. In the terminal run once:

```
npm install
```

## 1. Create the LINE Official Account and Messaging API channel (15 min)

1. Go to https://manager.line.biz and log in with your LINE account.
2. Create a new **LINE Official Account**. Name it something like "BitterSweet Demo (test)".
3. In the Official Account Manager open **Settings → Messaging API → Enable Messaging API**. Pick or create a Provider (any name, e.g. "BitterSweet").
4. Open the **LINE Developers Console** (https://developers.line.biz/console/), choose your Provider, then your channel.
5. Copy two values into your private note:
   - **Channel secret**: tab *Basic settings*.
   - **Channel access token (long-lived)**: tab *Messaging API*, bottom of the page, press *Issue*.

## 2. Turn off LINE's own auto-replies (3 min)

If you skip this, LINE sends its own greeting and "thanks for your message" next to the bot's answers.

1. Official Account Manager → **Settings → Response settings**.
2. Set **Chat** = on, **Webhook** = on, **Auto-response messages** = **off**, **Greeting message** = **off**.

(The bot sends its own greeting when someone adds the account. It is in `content/greeting_th.txt`.)

## 3. Create a Cloudflare account and log in (10 min)

1. Sign up (free) at https://dash.cloudflare.com/sign-up and verify your email.
2. In the terminal:

```
npx wrangler login
```

A browser window opens. Click **Allow**.

If the terminal stops with "Timed out waiting for authorization code" (it happens on Windows), use an API token instead: dash.cloudflare.com → My Profile → API Tokens → **Create Token** → template **Edit Cloudflare Workers** → add the permission **Account / D1 / Edit** → create. Then, in each new terminal window, run `$env:CLOUDFLARE_API_TOKEN = Read-Host "Paste Cloudflare token"`, paste the token at the prompt (never inside the command), and check with `npx wrangler whoami`.

## 4. Create the database (5 min)

The bot remembers conversations and counts messages in a small free Cloudflare database (D1).

```
npx wrangler d1 create bittersweet-concierge
```

The output shows a line like `database_id = "xxxxxxxx-xxxx-..."`. Open `wrangler.toml` and replace `REPLACE_WITH_D1_DATABASE_ID` with that value. Then create the tables:

```
npx wrangler d1 execute bittersweet-concierge --remote --file=schema.sql
```

## 5. Get an Anthropic (Claude) API key (10 min)

> **Which AI?** `wrangler.toml` sets `LLM_PROVIDER = "gemini"` by default: skip this step and follow [docs/GEMINI.md](docs/GEMINI.md), and in step 7 store `GEMINI_API_KEY` instead of `ANTHROPIC_API_KEY`. For the local Qwen model on a Mac mini, follow [docs/LOCAL-LLM.md](docs/LOCAL-LLM.md) and store `LLM_ACCESS_CLIENT_ID` and `LLM_ACCESS_CLIENT_SECRET`. Use this step only with `LLM_PROVIDER = "anthropic"`.

1. Go to https://console.anthropic.com, sign in, and add a small amount of credit (a few dollars is plenty for a demo).
2. Create a **separate workspace** just for this bot (Console settings → Workspaces → add workspace, e.g. "BitterSweet demo"). Open that workspace's limits and set a **monthly spend limit**, for example $10. If the key ever leaks, or the bot is spammed, the damage stops at that amount.
3. Create the API key **inside that workspace** (not in the default workspace) and copy it into your private note.

## 6. Create the Google Sheet that stores customers (15 min)

1. Create a new Google Sheet. Name it "BitterSweet CRM". (Do not create the "CRM" tab by hand; the script creates it.)
2. In the sheet: **Extensions → Apps Script**.
3. Delete the sample code and paste the whole content of `apps_script/Code.gs`.
4. Make up a long random secret of **at least 32 letters and digits** (a password manager can generate one). Write it in your private note: this is your **SHEETS_TOKEN**. Do **not** paste it into the code. Instead open **Project Settings** (gear icon on the left) → **Script properties** → **Add script property**, name `SHARED_TOKEN`, value = your secret, then Save. The script refuses every request if this property is missing, too short, or still looks like a placeholder.
5. Optional: put your email in `NOTIFY_EMAIL` at the top of the code to get an email when a customer needs the human perfumer (at most one per customer per day).
6. Click **Deploy → New deployment**, type **Web app**, and set:
   - **Execute as**: Me
   - **Who has access**: Anyone
7. Click **Deploy**, approve the permissions Google asks for, and copy the **Web app URL** (it ends in `/exec`). This is your **SHEETS_WEBHOOK_URL**.

Check it really is open to the bot: if `npx wrangler tail` later shows `crm_http_error 401` and **Executions** in Apps Script stays empty, Google is refusing anonymous callers. Open **Deploy → Manage deployments → Edit**, set **Who has access** to **Anyone** (not "Anyone with Google account"), pick **New version**, and deploy. Testing the URL in your own browser does not prove it, because there you are signed in.

Whenever you edit `Code.gs` later, use **Deploy → Manage deployments → Edit → New version**, or the old code keeps running.

## 6b. Anyone can send to that URL, so the token matters

The URL is public by design; the secret token inside each message is what protects the sheet. Never share the token.

## 7. Store the secrets in Cloudflare (10 min)

Run each command **exactly as written, without typing the secret in the command**. The command then asks you to paste the value at a hidden prompt; paste it there and press Enter. Never write a secret as part of the command line (it would stay in your terminal history).

```
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put GEMINI_API_KEY           # only if LLM_PROVIDER = "gemini" (docs/GEMINI.md)
npx wrangler secret put ANTHROPIC_API_KEY        # only if LLM_PROVIDER = "anthropic"
npx wrangler secret put LLM_ACCESS_CLIENT_ID     # only if LLM_PROVIDER = "local" (docs/LOCAL-LLM.md)
npx wrangler secret put LLM_ACCESS_CLIENT_SECRET # only if LLM_PROVIDER = "local"
npx wrangler secret put SHEETS_WEBHOOK_URL
npx wrangler secret put SHEETS_TOKEN
```

If wrangler says the Worker does not exist yet, answer **Yes** to creating it (or do step 8 first, then repeat this step).

## 8. Deploy (5 min)

```
npm run deploy
```

At the end it prints your address, like `https://bittersweet-line-concierge.<your-name>.workers.dev`. Your webhook address is that plus `/webhook`.

## 9. Connect LINE to the Worker (5 min)

1. LINE Developers Console → your channel → tab **Messaging API**.
2. **Webhook URL**: paste `https://<worker>.workers.dev/webhook`, press **Update**.
3. Press **Verify**. It must say **Success**.
4. Make sure **Use webhook** is switched on.
5. Leave **Webhook redelivery** off (default). The bot also ignores repeated deliveries by itself.

## 10. Test (10 min)

1. In the Messaging API tab scan the QR code with your phone and add the account. You should get the Thai greeting.
2. Chat in Thai. Try the scenarios in `../sim-line-demo/06_test/test_scenarios.md` (booth follow-up, gift, skin allergy, "I want to buy").
3. Say yes when the bot asks to save your profile: a row appears in the sheet's **CRM** tab.
4. Optional test without a phone (PowerShell):

```
.\scripts\send_test_event.ps1 -Url "https://<worker>.workers.dev/webhook"
```

   The script asks for the channel secret at a hidden prompt (it is not stored). **It talks to your live Worker: it really calls Claude (costs a little money), counts against the limits, and can write real rows to your Google Sheet if you use a real LINE user id.** The default fake user id is fine for a quick check. The fake test user id is not a real LINE id, so the sheet script rejects its rows (the Worker log shows `crm_http_error ... rejected`). It uses a fake reply token, so LINE refuses the final reply. That is normal; use step 11 to see that the Worker ran.

## 11. Watch live logs (2 min)

```
npx wrangler tail
```

**If `crm_delete_failed` appears, a customer's delete request did not reach the sheet: open the CRM tab and delete that customer's rows by hand** (the log never shows the id, so find the customer via the LINE chat, or ask the customer to repeat the request). You see one line per problem (for example `claude_http_error 401` means a wrong Anthropic key). For privacy the logs never show customers' messages or IDs. Press `Ctrl+C` to stop.

## 12. Download the QR code for the demo (3 min)

Official Account Manager → **Home → Add friends → QR code** (or the Messaging API tab in the Developers Console). Download it and put it on your slide.

## Optional: Rich Menu (10 min, no code)

Official Account Manager → **Rich menus**. Create a menu with buttons that send a message, for example "Which scent suits me?" or "Talk to the perfumer". The bot treats a tapped button as a normal text message.

---

## Limits and costs to know

- Free Cloudflare plan: the Worker allows 100,000 requests per day and D1 allows about 100,000 written rows per day. Each chat message writes roughly 8 to 10 rows, so a demo is far below the limit.
- Claude is the paid part. The bot stops calling Claude after **1,500 calls per day** in total, **60 messages per day** per person and **20 messages per 10 minutes** per person. Change the numbers in `wrangler.toml` (`[vars]`) and run `npm run deploy` again. The Anthropic workspace spend limit from step 5 is the last safety net.
- LINE reply tokens only work for about one minute, so if Claude is slow the customer may get no answer; try again.
- The sheet gets a full row (scent profile and their last message) only when the customer agreed to save their profile (PDPA). If they did not agree, a request for the perfumer still adds a row, but it holds only the LINE user id, the time and the flags: no message text and no profile, because a message can contain health information.
- When a customer asks the bot to delete their data: the bot erases the stored chat history, and the Google Sheet script deletes **every row of that customer from the CRM tab**. Copies you exported, emailed or screenshotted yourself are not touched, and the handoff alert email only contains the LINE user id.
- Once a customer says yes to saving their profile, the bot remembers that (a small "consent" record in the database) so later pre-order or profile rows are still saved; it is erased when they ask to delete their data. Chat history is kept for 7 days. A daily scheduled job (set in `wrangler.toml`, no setup needed) deletes older history and old counters. Messages are processed by Anthropic (the AI provider); the greeting tells customers this.

## Things still to fill in by hand

- `content/knowledge.md`: the exact scent notes for Fresh Leaf, Cilantro and Last Sip (marked `TODO(owner)`). They are not in the BIS608 PDF, so the bot will say it does not know them and offer to ask the perfumer.
- The Google Apps Script property `SHARED_TOKEN` (step 6) and optionally `NOTIFY_EMAIL` in `Code.gs`.
- A Thai speaker should proofread `content/greeting_th.txt` (the privacy sentence) and the fixed replies in `src/messages.ts` before the demo.
