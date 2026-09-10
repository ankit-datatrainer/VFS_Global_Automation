# Slot Relay

A free lookout network and readiness kit for **Bulgaria Type D (long-stay) visa
applicants in India**.

It exists because appointment slots are scarce and agents charge ₹20,000+ to
find one. It closes that gap by doing the two things that actually decide who
gets a slot: **knowing the moment one appears**, and **being fast enough to take
it**.

---

## The one rule

**Slot Relay never contacts VFS Global.**

Not slowly, not politely, not from a hidden browser. It sends zero requests to
`visa.vfsglobal.com`. There is an automated test that enforces this
(`npm test` → *"Slot Relay never sends a request to VFS"*), and it will fail the
build if anyone ever adds one.

Every sighting comes from a human who was already on the official portal, doing
what they were entitled to do, who tapped once to tell everyone else.

You always do the booking yourself, by hand, at
<https://visa.vfsglobal.com/ind/en/bgr>.

---

## Why this beats refreshing alone

| | Alone | With Slot Relay |
|---|---|---|
| Hours covered | when you're awake | whenever *anyone* in the group looks |
| You learn a slot opened | if you happen to refresh | within seconds, with a loud alarm |
| Knowing when to look | guesswork | a real weekday × hour map built from what people saw |
| Filling the form | hunting for your passport | practised, under 60 seconds |

Twenty people each checking twice a day is forty looks a day. Nobody increases
their own load at all, and everybody gets forty times the coverage.

---

## Setup

Needs Node 22.5+ (Node 24 recommended). **No `npm install` required** — the
project has zero dependencies and runs entirely on Node built-ins.

```bash
npm run check
```

That verifies your Node build has everything needed. Then:

```bash
cp .env.slot-relay.example .env.slot-relay
```

Fill in a Telegram bot token if you want phone alerts (see below), then:

```bash
npm start
```

Open <http://127.0.0.1:4140>.

### Telegram alerts (optional, recommended)

Telegram is what wakes you at 3am when someone spots slots.

1. Open Telegram → message **@BotFather** → `/newbot`
2. Copy the token it gives you into `TELEGRAM_BOT_TOKEN` in your `.env`
3. Restart `npm start`
4. Message your new bot `/start`, then `/watch DEL` (or `/watch all`)

On your phone, long-press the bot chat → **notifications → make it an exception
to Do Not Disturb**, with a custom loud sound. That is the difference between
hearing it and not.

### Your readiness vault

```bash
npm run vault -- init
```

Stores **your own** details, AES-256-GCM encrypted, on this machine only. It
holds no passwords of any kind — a password manager is the right place for
those. Check your readiness any time:

```bash
npm run vault -- check
```

### The drill

```bash
npm run drill
```

Times you filling the real form's fields from memory, against a local mock.
Tells you which fields cost you the most seconds. **Aim for under 60 seconds
with zero mistakes.** This is the single highest-value thing in this repo — the
slot is usually lost while you hunt for your passport number, not while you
type.

---

## Telegram commands

**When you're on the portal**
- `/seen DEL 15 Sep, 18 Sep` — slots are open, tell everyone
- `/empty DEL` — you looked, nothing there *(this is what builds the pattern map — please send it)*
- `/gone 42` — sighting 42 is used up

**Your settings**
- `/watch DEL BOM` or `/watch all`
- `/deadline 2026-11-30` — your job start or permit expiry; drives your priority
- `/mute 8` / `/unmute`
- `/booked` — you got one 🎉

**Info**
- `/status` — what's live now
- `/pattern` — when slots have actually appeared
- `/centres` — the six centres and their addresses

---

## Fairness — why this can't become a tout tool

A slot feed with no limits is exactly what an appointment agent wants. So:

- **Order is reshuffled on every single alert.** Nobody has a standing head
  start. The only thing that earns an earlier wave is a genuinely near deadline.
- **12 alerts per person per day, 90-second cooldown.** Enough to catch a real
  slot; useless as a firehose.
- **No private feed.** There is no command for "only tell me". It does not exist.
- **Free-riders go last.** Take alerts for two weeks without ever reporting, and
  you move to the back of every fan-out.
- **You retire after you book.** `/booked` keeps you on for 7 more days so you
  can help the next person, then removes you automatically.

These are enforced in code (`src/alerts.js`) and covered by tests.

---

## What it stores about people

Almost nothing, on purpose.

| Stored | Not stored |
|---|---|
| Telegram chat id | Name, passport number, date of birth |
| Which centres you watch | VFS username or password |
| Your deadline date (optional) | Any document, scan or photo |
| Counts: alerts received, reports made | Payment details |

Your identity documents live only in **your** vault, on **your** machine, under
**your** passphrase. They are never sent to Telegram, never shown on the
dashboard, and never leave the disk.

---

## The six centres

Bulgaria Type D services launched in India on 1 November 2025.

| Code | City | Centre |
|---|---|---|
| DEL | New Delhi | Mezzanine Floor, Baba Kharak Singh Marg, Shivaji Stadium Metro Station, Connaught Place |
| BOM | Mumbai | Trade Centre, 1st Floor, G Block, Bandra Kurla Complex, Bandra (East) |
| BLR | Bengaluru | 22, Gopalan Innovation Mall, Bannerghatta Main Rd, J. P. Nagar |
| MAA | Chennai | Ramee Mall, 2nd Floor, No. 365, Anna Salai, Teynampet |
| CCU | Kolkata | 5th Floor, Rene Tower, 1842 Rajdanga Main Road, Kasba |
| AMD | Ahmedabad | Ground Floor, Shree Balaji Agora Mall, Sardar Patel Ring Road, Motera |

---

## What is in this folder

**Two separate codebases currently live here.**

Slot Relay is:

```
start.js  config.js
src/db.js  src/alarm.js  src/alerts.js  src/intel.js
src/server.js  src/telegram.js  src/vault.js  src/public/
tools/  test/relay.test.js  test/smoke-server.js
```

There is **other code in this folder that does automate VFS** — under
`src/monitor/`, `src/booking/`, `src/candidates/`, and `src/dashboard/`. It uses
Playwright with fingerprint-spoofing to log in and book automatically. It is not
part of Slot Relay, it is not covered by any guarantee here, and `npm test`
prints an advisory listing it.

Running that code risks the applicant's VFS account being flagged. Decide
deliberately which of the two you are running.

---

## Tests

```bash
npm test                    # 21 unit tests
node test/smoke-server.js   # 22 end-to-end dashboard checks
```

---

## Honest limits

- **It is only as good as its lookouts.** With three people it is barely better
  than checking alone. It gets genuinely useful somewhere around 15–20 active
  people spread across the day.
- **A relayed sighting can be stale.** If slots vanish in two minutes, a report
  that reaches you 90 seconds later may already be dead. `/pattern` will tell
  you the real median once there's data.
- **It cannot create slots.** If Bulgaria releases none, no tool helps. What it
  can do is make sure that when they do, you are not the person who found out
  the next morning.

MIT licensed. No warranty. You are responsible for your own application.
