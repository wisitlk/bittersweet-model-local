# Aquatic Jewel — knowledge base for the LINE Betta Concierge

Source: the shop's web projects (wisitlk/betta-fish-web, wisitlk/fish-store-betta) + general betta-keeping basics.
This file is the ONLY source of truth for the agent. If a fact is not here, the agent must say it does not know and
offer to ask the shop staff.

> PLACEHOLDER DATA: the fish names come from the shop's demo catalogue; the THB prices and the starter kit are
> examples until the owner confirms the real ones. Edit this file, src/catalog.ts and src/checkout.ts together.

## Shop
- **Aquatic Jewel** is a small Thai betta fish (ปลากัด) shop. Line: "Authentic Bettas from Thailand".
- Every fish is shown with its own photo or video: **what you see is the fish you get** (WYSIWYG). Once a fish is
  sold it is marked SOLD OUT.
- Fish are checked for health before shipping.
- **Live arrival guarantee:** if a fish arrives dead, the customer tells the staff in this LINE chat with an unboxing
  photo or video; the staff sort it out (handoff). The agent never promises a refund amount or a replacement itself.
- Channels: LINE OA (this chat), the shop's website.

## Products and prices (example prices, THB)
| Fish | Type | Sex | Price |
|---|---|---|---|
| Red Dragon Halfmoon | Halfmoon (long fin) | Male | 450 THB |
| Blue Rim Plakat | Plakat (short fin) | Male | 350 THB |
| Black Samurai | Plakat (short fin) | Male | 590 THB |
| Galaxy Koi | HMPK (half-moon plakat) | Female | 250 THB |
| Nemo Candy | Plakat (short fin) | Male | 390 THB |

- **Starter kit (ชุดเริ่มต้นเลี้ยง):** 5-litre tank, betta pellets, water conditioner and dried Indian almond leaves
  (ใบหูกวาง). Bought together with a fish for **+390 THB**. Not sold on its own in this demo.
- Stock changes every day and each fish is one of a kind: the agent never says how many are left. To check whether
  a fish is still available, the customer looks at "หน้าร้าน" or asks the staff.

## The five fish

### Red Dragon Halfmoon
- Long, flowing tail that opens to a half circle (180°) when the fish flares. Deep red body with a metallic "dragon
  scale" sheen.
- Good for: people who love show-style long fins and want a centrepiece on a desk or shelf.
- Care note: long fins tear more easily; no sharp decorations, gentle filter flow.

### Blue Rim Plakat
- Short fins, fast and active swimmer; blue edges on the fins.
- Good for: first-time keepers; plakats are tough and active and show their personality.

### Black Samurai
- Short-fin plakat with a deep black body and silver-edged "armour" scales.
- Good for: people who like a bold, dark, striking fish; a collector's piece.

### Galaxy Koi (female)
- Half-moon plakat female with a koi-like pattern and small sparkling dots ("galaxy").
- Good for: people who want a small, colourful fish for a desk.
- Note: females can still fight; one betta per tank is the safe choice for beginners.

### Nemo Candy
- Short-fin plakat with bright orange, red, black and white patches, like a clownfish or candy.
- Good for: people who like unusual colours and patterns.

## Choose by what the customer wants (เลือกปลาไม่ถูก ดูจากแบบนี้)
| The customer wants | Suggest |
|---|---|
| First betta, easy to keep | Blue Rim Plakat |
| Long, flowing show fins | Red Dragon Halfmoon |
| A bold, dark fish | Black Samurai |
| A small, colourful fish for a desk | Galaxy Koi |
| Unusual colours and patterns | Nemo Candy |

No tank yet: suggest the fish together with the starter kit.

## Basic betta care (general advice the agent may give)
- **One male per tank.** Male bettas fight; never put two males together. Don't mix bettas with fin-nipping fish.
- **Tank:** 5 litres or more is easier to keep stable than a small jar. Keep a lid or cover: bettas can jump.
- **Water:** let tap water stand or use water conditioner to remove chlorine before use. Comfortable temperature is
  about 25–30 °C; avoid sudden changes.
- **Water changes:** change about a quarter to a third of the water every week (more often in small jars), using
  water of the same temperature.
- **Food:** betta pellets once or twice a day, only what the fish eats in about 2 minutes; remove leftovers.
- **Indian almond leaves (ใบหูกวาง):** commonly used by Thai betta keepers; they tint the water brown.
- **Arrival / acclimatisation:** float the closed bag in the tank for 15–20 minutes so the temperature matches, then
  add a little tank water to the bag a few times before releasing the fish. The fish may be pale or hide for a day;
  it is normal after a trip.
- **Sick fish** (white spots, clamped fins, not eating for days, fin rot, swelling): the agent does NOT diagnose or
  give medicine doses; it hands off to the staff (handoff) and meanwhile suggests a partial water change.

## Status and policies (DEMO STATE)
- Customers buy at "หน้าร้าน" in the LINE web app (the link is added to the reply automatically) → choose a fish,
  with or without the starter kit, optional points discount, shipping address, PromptPay QR, then send the slip in
  the LINE chat. Shipping cost is confirmed by staff in the chat before the transfer. Until the shop sets its
  PromptPay number, the buy button is a demo and nobody can pay.
- The agent never takes orders, payments, slips or addresses in the chat and never promises a delivery date;
  order and delivery questions go to staff (handoff).
- **Points (members):** sign up 50, add LINE friend 10, PDPA consent 20, fish survey 30, and 1 point per 10 THB
  paid once staff confirm the payment. Redeem at checkout, one per order, on the products total:
  50 points = 20% off, 200 points = 50% off. Points used on a cancelled order come back.

## Who we serve (segments the agent tags in CRM)
| Tag | Definition | How the agent talks |
|---|---|---|
| first_timer | First betta, wants something easy | Suggest Blue Rim Plakat (+ starter kit if no tank) |
| show_lover | Loves long show fins | Suggest Red Dragon Halfmoon; mention gentle flow |
| bold_collector | Likes dark, striking fish | Suggest Black Samurai |
| desk_keeper | Wants a small colourful fish for a desk | Suggest Galaxy Koi |
| color_hunter | Likes unusual colours and patterns | Suggest Nemo Candy |
| kit_buyer | Has no tank yet / wants the starter kit | Explain what the kit contains |
| gift_seeker | Buying a fish as a gift | Remind them a live animal needs daily care; ask if the person is ready |
| repeat_keeper | Already bought a fish here | Thank them; ask how the fish is doing |

Customers under 20 are minors: never push them to buy, never create urgency, and note that a parent or guardian
must agree before their profile can be saved.

## Hard rules
- Never invent fish, prices, discounts, stock numbers, ages, bloodlines or delivery dates.
- Never use fake urgency ("only one left today!") or fear.
- Animal welfare first: never suggest keeping two males together, tiny containers without water changes, or
  "decorating" fish (dyed fish). If a customer describes a sick fish, hand off.
- PDPA: ask consent before saving the customer's profile; delete on request. Under 20: guardian consent too.
- Always disclose being an AI assistant; always offer a human (the shop staff) on request.

## FAQ
- **Do you ship?** Yes, within Thailand; staff confirm the shipping cost in the chat before payment.
- **Is the fish in the photo the one I get?** Yes, each listing is one specific fish.
- **Can I keep two bettas together?** Not two males. For a first fish, keep one betta per tank.
- **Do I need a filter or heater?** Not required for a 5-litre tank in Thai room temperature, but a gentle sponge
  filter helps keep the water stable; change water regularly either way.
- **How long do bettas live?** Usually around 2–3 years with good care.
