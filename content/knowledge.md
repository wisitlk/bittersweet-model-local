# BitterSweet — knowledge base for the LINE Scent Concierge

Source: product sheet "ข้อมูลสินค้า BitterSweet" V0.0.6 (2026-10-28) + BIS608/BIS609 project. This file is the ONLY
source of truth for the agent. If a fact is not here, the agent must say it does not know and offer to ask the perfumer.

## Brand
- BitterSweet is a small Thai niche perfume house. Brand line: **"You wear it for you first."** Perfume for the wearer.
- Series: **"กลิ่นเรื่องเล็กๆ ที่ทำให้ตัวเอง"** (small things we do for ourselves). The 5 scents are named after moments
  we do something for ourselves: a slow morning with tea, a toast to yourself, a long warm bath, cancelling plans to
  stay in, a midday break with fruit.
- Every bottle is **Eau de Parfum, 20% perfume oil**; it stays on the skin through the day.
- Values: honesty ("the brand never promises more than the product can do"), no hard selling.
- Channels: Instagram, craft-fair booths (people can smell all 5 scents in person), LINE OA.

## Products and prices
| Product | What it is | Price |
|---|---|---|
| Bottle 10 ml | Eau de Parfum, tea-coloured spray bottle, with box and scent-note card | 450 THB |
| Sample 5 ml | One scent, clear glass spray bottle | 249 THB |

- **Sample credit:** buy a Sample 5 ml, then come back and buy a 10 ml bottle **within 30 days** → the 249 THB is
  credited back, so the bottle costs only **201 THB more**.
- All 5 scents have the same prices. There is no discovery set in this series.

## The five scents (No. 01–05)

### No. 01 Slow Morning — "เช้าที่ไม่ต้องรีบไปไหน"
- Short: green tea, soft, clean (ชาเขียว นุ่ม สะอาด).
- Smells like: soft matcha green tea, like a warm cup held in both hands, then light clean woods, not sharp.
- Good for: people who like clean, quiet scents that are not louder than the person next to them; green-tea and
  morning-café lovers; office workers who want one scent for every day without thinking.
- When: mornings before leaving home, work days.

### No. 02 Self Toast — "ชนแก้วให้ตัวเอง ไม่ต้องมีเหตุผล"
- Short: citrus, white flowers, sparkling (ซิตรัส ดอกไม้ขาว มีประกาย).
- Smells like: fizzy fresh citrus like opening champagne, then white flowers and rose, finishing with warm amber.
- Good for: people who like bright, sparkling scents that others around them notice; celebrating yourself on an
  ordinary day; people who like flowers but not heavy floral scents.
- When: good-news days, meeting friends, dates, small parties, evening to night.

### No. 03 Long Bath — "น้ำอุ่น ประตูปิด เวลาที่เป็นของเราคนเดียว"
- Short: soap bubbles, powder, musk (ฟองสบู่ แป้ง มัสก์).
- Smells like: soap bubbles and soft flowers at first, then soft powder and skin musk, like just out of the shower.
- Good for: people who like a just-showered clean-skin scent; powder and musk that stays close to the skin, not
  spreading far; people who wear perfume for themselves more than for others.
- When: after a bath, before bed, rest days at home.

### No. 04 Stay In — "ยกเลิกนัด แล้วเลือกโซฟา"
- Short: powder, woods, warm musk (แป้ง ไม้ มัสก์ อุ่นๆ).
- Smells like: soft powder and faint flowers at first, slowly warming into woods, musk and a little vanilla, like a
  favourite blanket.
- Good for: people who like warm, woody scents and dislike fresh sour ones; homebodies who love books, series and
  blankets; people who want a scent that stays on clothes.
- When: days at home, air-conditioned rooms, rainy season, evening until bedtime.

### No. 05 Tea Break — "วันหยุดสบายๆ ที่ไม่มีอะไรต้องทำ"
- Short: pear, green tea, lily (แพร์ ชาเขียว ลิลลี่).
- Smells like: crisp fresh pear first, then green tea and lily, finishing with musk and light cedarwood.
- Good for: people who like fresh fruit that is not cloying; people new to perfume who want something easy to wear;
  café hoppers who like weekends without plans.
- When: weekends, cafés, afternoons, hot weather when you want something light and fresh.

## Choose by occasion (เลือกกลิ่นไม่ถูก ดูจากแบบนี้)
| The customer wants | Suggest |
|---|---|
| A scent to wear to work every day | Slow Morning |
| A scent people notice, for special days | Self Toast |
| A just-showered clean scent | Long Bath |
| A warm woody scent for days at home or the rainy season | Stay In |
| New to perfume, or a light fruity scent | Tea Break |

Still unsure: smell all 5 at the booth, take the favourite home as a Sample 5 ml, wear it for two or three days, then
come back for the 10 ml bottle within 30 days (Sample 249 THB credited).

## How to try (skin test advice)
- Wear the Sample on skin for two or three days and notice how it feels on you through the day.
- Customers with sensitive skin: test on the inner elbow or forearm first. Do NOT give medical advice — hand off to
  the perfumer.

## Status and policies (DEMO STATE)
- **Not selling yet.** Thai FDA cosmetic notification (เลขจดแจ้ง อย.) is in progress. Until it is done we cannot
  produce, ship or sell. → The agent may only add people to the **pre-order / waitlist**. No orders, no payments, no
  addresses, no delivery promises.
- Ingredients: the full INCI list will be on the label (not available in the demo) → hand off ingredient questions.
- Delivery dates: never promise any.

## Who we serve (segments the agent tags in CRM)
| Tag | Definition | How the agent talks |
|---|---|---|
| calm_planner | Likes routine, clean quiet scents, wears perfume to work | Suggest Slow Morning |
| social_spark | Outgoing, wants a scent for dates and good days | Suggest Self Toast |
| self_care_ritualist | Wears perfume for themself, after a bath or before bed | Suggest Long Bath |
| cozy_homebody | Loves staying home, likes warm woody scents | Suggest Stay In |
| easy_explorer | New to perfume, likes light fruit, cafés, weekends | Suggest Tea Break |
| booth_smeller | Smelled at a booth, added LINE, not bought | Ask which scent is still on their mind |
| sample_trier | Has or wants a Sample 5 ml | Explain the 30-day 249 THB credit |
| gift_seeker | Asking for a gift | Be honest: perfume is personal; suggest a Sample first |
| repeat_wearer | Already wears a BitterSweet bottle | Thank them; ask how it wears on them |

Customers are mostly 14–40. **Under 20 is a minor:** never push them to buy, never create urgency, and note that a
parent or guardian must agree before their profile can be saved.

## Hard rules (ethics + law)
- Never use wellness / mood claims ("relieves stress", "helps you relax", "makes you calm", "boosts mood"). Describe
  what the scent smells like and when people wear it, not what it does to feelings.
- Never invent scarcity or urgency, stock numbers, prices, discounts, notes, ingredients or dates.
- Never use fear or insecurity.
- Anchoring only with real prices: "Sample 249 THB, credited back on a 450 THB bottle within 30 days".
- PDPA: ask consent before saving the customer's scent profile; delete on request. Under 20: guardian consent too.
- Always disclose being an AI assistant; always offer a human (the perfumer) on request or for skin, allergy or
  ingredient questions (reply within 24 h).

## FAQ
- **Is it unisex?** Yes, all five scents are unisex.
- **How long does it last?** Eau de Parfum with 20% perfume oil; it stays on the skin through the day (how long
  exactly depends on skin).
- **Can I smell it somewhere?** At BitterSweet booths at craft fairs (dates announced on Instagram / LINE).
- **Can I buy now?** Not yet — we are waiting for the Thai FDA notification. I can add you to the pre-order list.
- **Is there a discovery set?** Not in this series. Try one scent as a Sample 5 ml (249 THB), credited back on a
  10 ml bottle within 30 days.
- **Gift?** Perfume is personal; a Sample lets the person choose their own scent first.
