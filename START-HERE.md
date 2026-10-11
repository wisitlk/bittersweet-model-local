# Start here — BitterSweet LINE chatbot

*ภาษาไทย: see `START-HERE.th.md`*

Welcome. You are taking over a small, working chatbot for **BitterSweet**, a Thai niche perfume
brand. This page explains, in plain words, what it is, how it works, and what you need to do to
run your own copy. No programming knowledge is needed to follow it.

## 1. What it is

BitterSweet has a **LINE Official Account**. When a customer chats with that account, an AI
assistant called **Scent Concierge** answers them, in Thai by default (or in the customer's
language). It:

- answers questions about the brand and its three scents — **Fresh Leaf**, **Cilantro** and
  **Last Sip** — using only facts we wrote down for it;
- helps the customer choose a scent honestly, including saying when a scent is probably not for
  them (Cilantro is "love it or hate it");
- suggests the **discovery set** (3 × 2 ml, 350 THB, fully credited when they later buy a
  450 THB bottle);
- with the customer's permission, **remembers their scent profile** in a Google Sheet that works
  as a simple customer list (CRM);
- adds people who want to buy to a **pre-order waiting list**;
- passes questions about **skin, allergies, ingredients or complaints** to a human perfumer.

**It never sells.** BitterSweet may not sell until its Thai FDA cosmetic notification
(เลขจดแจ้ง อย.) is issued; first sales are planned for May 2027. So the bot takes no orders,
payments or addresses. This is on purpose: the whole idea, from the BIS608/BIS609 project, is
"a Scent Concierge that tells the truth".

The plan for the demo: print the account's **QR code**, let students scan it and chat with the bot.

## 2. How it works

```
Customer's phone (LINE)
      │  writes a message
      ▼
LINE ──────────────►  Our small program on Cloudflare (a "Worker")
                         │  1. checks the message really came from LINE
                         │  2. looks up this person's recent chat
                         │  3. asks Claude (the AI) for an answer
                         │  4. sends the answer back to LINE
                         │  5. if the customer agreed, saves their profile
                         ▼
                      Google Sheet "BitterSweet CRM"  (your customer list)
```

Four accounts are involved, and **all four must be your own**:

| Account | What it does here | Cost |
|---|---|---|
| **LINE Official Account** (+ LINE Developers) | The chat account customers add, and the "Messaging API" that forwards messages to our program | Free. Replies to customers are free. |
| **Cloudflare** | Runs our program 24/7 at a fixed web address, and keeps a small database (chat memory, consent, limits) | Free plan is enough |
| **Anthropic (Claude API)** | The AI that writes the answers | Pay per use; a demo with a few people costs a few dollars. Set a spending limit. |
| **Google** | The Sheet that stores customer profiles, plus a small script that writes into it | Free |

Your computer is only needed for setting things up. Once deployed, the bot runs on Cloudflare even
when your computer is off.

## 3. What is in this folder

| Item | What it is |
|---|---|
| `START-HERE.md` / `START-HERE.th.md` | This page (English / Thai) |
| `SETUP.md` | The detailed, step-by-step build instructions (about 2 hours) |
| `HANDOFF.md` | Technical notes: decisions already made, problems we hit, open items |
| `CLAUDE.md` | Instructions for Claude Code, so it understands the project immediately |
| `content/` | **What the bot knows and how it talks** — knowledge base, AI instructions, greeting. Edit these to change the bot's answers. |
| `apps_script/Code.gs` | The script you paste into your Google Sheet |
| `src/`, `test/`, other files | The program itself and its automatic checks |
| `reference/` | The BIS608/BIS609 decks and report the bot is based on |

Nothing secret is in this folder: no passwords or keys. You create your own.

## 4. What you need to do

**Easiest way: let Claude Code guide you.** Install Claude Code (https://claude.com/claude-code),
open this folder in it, and write:

> Read CLAUDE.md and HANDOFF.md, then guide me through SETUP.md one step at a time.

It will tell you what to click and type, and check each step with you. Send it screenshots when
unsure. **Never paste a key, token or password into the chat** — the instructions show where each
one goes instead.

**Or follow `SETUP.md` yourself.** The checklist:

1. ☐ Install **Node.js** (LTS) from nodejs.org. In this folder run `npm install`.
2. ☐ Create a **LINE Official Account** (region **Thailand**) and enable **Messaging API**.
   Keep two values private: the **Channel secret** and a **Channel access token**.
3. ☐ In LINE OA Manager → Response settings: turn **off** Greeting message and Auto-response.
   Do not turn on LINE's own "AI Chatbot (Beta)".
4. ☐ Create a **Cloudflare** account and connect your terminal to it.
5. ☐ Create the small **database** (two commands).
6. ☐ Create an **Anthropic** API key in a separate workspace with a monthly spending limit
   (for example 10 USD).
7. ☐ Create the **Google Sheet**, paste the script, give it a long random password, and publish it
   as a web app open to **Anyone**.
8. ☐ Give the five keys to Cloudflare (each is pasted at a hidden prompt, never typed in a command).
9. ☐ **Deploy** the bot (`npm run deploy`).
10. ☐ Paste the bot's address into LINE, press **Verify**, turn on **Use webhook**.
11. ☐ **Test from your phone** (see below).
12. ☐ Download the **QR code** for the demo.

## 5. How to know it works

Chat with your account in LINE and try these:

1. *"I smelled Cilantro at the booth but I'm afraid it's too green for work."*
   → honest advice, suggests the discovery set or Last Sip.
2. *"I liked Cilantro. You can remember my scent profile, I agree."*
   → a new row appears in the Sheet's **CRM** tab.
3. *"I want to buy a bottle of Fresh Leaf."*
   → explains sales start in May 2027 and offers the waiting list; never takes an order.
4. *"I have sensitive skin, can I use this?"*
   → passes you to the perfumer; the Sheet row shows `handoff = TRUE`.

To watch what the bot is doing while you test, run `npx wrangler tail` in the terminal.

## 6. Still to do

- **Scent notes:** the exact top, heart and base notes of the three scents are missing. Get them
  from the perfumer and add them in `content/knowledge.md` (marked `TODO(owner)`).
- **Thai check:** the Thai texts were written by AI. Please read `content/greeting_th.txt` and the
  bot's answers, and fix anything that sounds unnatural.
- **Sheet layout:** right now every profile update adds a new row. Decide whether you want one row
  per customer instead.

## 7. Changing the bot later

- **What it knows or how it speaks:** edit the files in `content/`, then run `npm run deploy`.
- **Changing the AI model** needs a small code change first — ask Claude Code; see `HANDOFF.md`.
- If something breaks, run `npx wrangler tail`, send a message, and show the output to Claude Code.
