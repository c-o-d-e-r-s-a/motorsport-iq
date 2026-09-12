# Motorsport IQ — Onboarding Brief

**Read this first.** It is the story of the product: why it exists, what we shipped, and where we are heading. Technical depth lives in [`AGENTS.md`](./AGENTS.md).

**Live app:** [motorsport-iq.vercel.app](https://motorsport-iq.vercel.app) · **Guide:** [/guide](https://motorsport-iq.vercel.app/guide)

---

## In one minute

Motorsport IQ is a **live Formula 1 prediction companion**. You watch the race, the app reads real telemetry, and it fires short yes/no questions at the moments that matter — overtakes, pit windows, closing gaps, late-race finishing order.

You have **45 seconds** to lock a call. Correct answers score points, streaks add bonuses, and a live leaderboard updates after every result.

It is **not betting, not fantasy, not trivia**. Outcomes come from the real race. The server decides everything; the phone just plays along.

We are an early-stage, **pre-revenue, fan-made beta**. No sign-up — pick a driver name and play.

---

## Why it exists

Grand Prix starts are electric. Then the field settles, gaps open, and for twenty laps the broadcast goes quiet. That is when fans pick up their phones and drift away.

We built Motorsport IQ to **fix the quiet middle**. If you are reading the race, calling the next move, and competing with friends, those “boring” stints become the best part of the watch party.

---

## The journey

### Where we started (early 2026)

The first version was a tight MVP spec, originally written as an agent-ready build prompt (kept for history in [`documentation/legacy_claude_prompt.md`](./documentation/legacy_claude_prompt.md)):

- Private 6-character lobbies, no accounts
- Questions triggered from **OpenF1** polling every 10 seconds
- **20-second** answer window
- Six question families, including Energy Battle and Strategy
- Hard cap of ~10 questions per race
- Frontend on **Vercel**, backend on **Railway**, data in **Supabase**
- AI copy from Groq / Llama (the first draft mentioned Claude; we shipped Groq)

The non-negotiable rules from day one still hold:

1. **Server-authoritative** — clients never score, trigger, or resolve
2. **Lap-based resolution** — no mid-lap guesswork
3. **One active question** per lobby
4. **Not betting** — structured prediction, real outcomes

### How we got here

| When | What changed |
|---|---|
| **Mar 2026** | First production deploy: Vercel frontend + Railway backend |
| **Apr 2026** | Backend moved to **Render** (free tier). Supabase URL typo that broke lobby creation was fixed |
| **May 2026** | Live races switched to the **F1 SignalR** timing feed. OpenF1 kept for replay and session lists |
| **Spring–summer** | Answer window grew to **45s**. Question bank narrowed to four observable categories. Adaptive pacing (8–15 on a GP, lower floor on sprints) |
| **Jun 2026** | **Public / solo lobbies** with atomic matchmaking, auto-start, late-join, score restore |
| **Since then** | Mobile-first “Race Night” UI, PWA / add-to-home-screen, push race alerts, Pit Wall Arcade, memes, in-game notifications, admin reporting |

### Where we are now

A playable race-night product, still beta, used alongside the broadcast.

**Play**
- **Friends:** create a private room, share the code
- **Solo:** jump into a public lobby for the same session
- **Live:** lobby opens **45 minutes** before lights out, then runs with the broadcast
- **Replay:** any past Grand Prix, real telemetry, start whenever you want
- **Arcade:** four mini-games (Start Lights, Pit Stop, Grid Dash, Strategy Recall) with device-local high scores
- Install as a **home-screen app**. Turn on **race alerts** (~30 min before a session) and **question pings** if you tab away

**Gameplay**
- Categories: `OVERTAKE` · `PIT_WINDOW` · `GAP_CLOSING` · `FINISH_POSITION` (Final Stretch only in the last ~15% of distance)
- Typical GP: **8–15 questions**. Sprints use a lower adaptive floor
- Scoring: **+10** correct, **−5** wrong, **0** timeout. Streak bonuses at 3 and 5+
- After each call: AI explanation (Llama 3.3 via Groq) plus a meme. If Groq is down, template text still works
- Safety cars / VSC / red flags pause or cancel questions by rule — they never invent an outcome

**Under the hood**

```
Phone / PWA  →  Socket.io  →  Express backend
                                  ├─ SignalR (live timing)
                                  ├─ OpenF1 (replay + session list)
                                  ├─ Question + resolution engines
                                  ├─ Groq (copy + username moderation)
                                  └─ Supabase (lobbies, answers, scores)
```

| Layer | Today |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind v4 — [Vercel](https://motorsport-iq.vercel.app) |
| Backend | Node + Express + Socket.io — [Render](https://motorsport-iq-backend.onrender.com) (free tier) |
| Database | Supabase Postgres (`rwwdnhclabuqvoxqzrcy`, us-east-2) |
| Live data | F1 SignalR WebSocket |
| Replay data | OpenF1 API |
| AI | Groq `llama-3.3-70b-versatile` |

Render sleeps after ~15 minutes idle. A cron ping plus an in-tab keep-alive fight that; the home page still shows a **warming up** banner on cold start (~30–60s). That is a known production constraint, not a mystery bug.

---

## How a race night works

```
Join (solo or friends)
   → Waiting room (pre-race) or straight into a live/replay session
   → After laps 1–3, questions start when the track is green
   → TRIGGERED (1s) → LIVE (45s) → LOCKED → ACTIVE → RESOLVED → EXPLAINED
   → Leaderboard updates → next question after cooldown
   → Chequered flag → podium
```

A few rules that surprise people:

- No questions on laps 1–3, during SC/VSC/red, or two of the same category in a row
- 1-lap cooldown after a restart, 2-lap cooldown after a result
- If you disconnect, `lobby_state` restores you. Scores are keyed by **player id on the device**, not display name
- Public lobbies auto-start when the session goes live. Private lobbies wait for the host
- Late joiners start from the **next** question — no backfill

---

## How the codebase is shaped

```
frontend/     Next.js app — home, lobby, game, guide, arcade, admin
backend/      Game server — engine, lobbies, live/replay runtime, AI, admin
backend/schema/   SQL migrations (run in the Supabase dashboard, not only in git)
.agent/skills/f1-engine/   Question, SC, and scoring rules for agents
docs/ + documentation/     Audits, migration notes, original spec
marketing/    Trailers, logos, social assets
```

The important idea: **game logic lives on the backend**. If you are changing who wins a question, you are in `backend/src/engine/` and `lifecycleManager.ts`, not in a React component.

| If you are working on… | Start here |
|---|---|
| Triggers, pacing, outcomes, points | `backend/src/engine/` + [`.agent/skills/f1-engine/`](./.agent/skills/f1-engine/SKILL.md) |
| Lobbies, presence, public matchmaking | `backend/src/lobby/` |
| Live vs replay sessions | `backend/src/runtime/` + `backend/src/data/` |
| Question copy / explanations | `backend/src/ai/` |
| Player screens | `frontend/src/app/` + `frontend/src/components/` |
| Design language | [`frontend/DESIGN.md`](./frontend/DESIGN.md), [`frontend/MOTION.md`](./frontend/MOTION.md) |
| Deploy / env vars | [`AGENTS.md`](./AGENTS.md) |
| Scaling the live race | This brief (Phase 0–4) · [`scaling-architecture.md`](./backend/docs/scaling-architecture.md) · [`scaling-playbook.md`](./backend/docs/scaling-playbook.md) |

Always use **npm** (not yarn/pnpm). Node 22+ locally.

```bash
cd backend && npm install && npm run dev    # :4000
cd frontend && npm install && npm run dev   # :3000
cd backend && npm run test                  # engine + lobby tests
```

---

## Where we are heading

This is the direction already written into the product: the **Live Session Scalability Plan** (500 → 5,000+), race-weekend reliability work, deferred game categories, and community growth.

### 1. Make every race weekend hold up

Still beta, still improving race by race. Near-term work is reliability, not new sports:

- Cleaner live-feed handling (SignalR auth, stalled-feed behaviour, tyre/stint noise)
- Question pacing that actually lands 8–15 prompts on a GP and fewer on a sprint
- Reconnect, late-join, and score-restore under real watch-party chaos
- Keep-alive / cold-start so “Create lobby” does not sit on a sleeping server

Feedback from `/guide` and in-game **Report a problem** is how this queue gets filled.

### 2. Scale live sessions — Phase 0 → Phase 4

The scaling plan is: keep gameplay correct, then grow capacity in gates. **Phase 0 and Phase 1 are shipped.** Phase 2+ is flagged or documented, not live. Production is still **one Render instance**, no Redis.

**SLOs we hold every race**

- p95 `question_event` delivery &lt; 500ms (p99 &lt; 1s)
- p95 `submit_answer` ack &lt; 300ms
- p95 resolution publish &lt; 1s after lock
- Reconnect + state catch-up &lt; 3s p95
- &lt; 0.1% dropped critical events per race

| Phase | Target | What it is | Status |
|---|---|---|---|
| **0** | Baseline | Observability (`/health/scaling`, latency histograms, queue + DB metrics). Safety rails (`MAX_ACTIVE_LOBBIES`, `MAX_PLAYERS_PER_LOBBY`). Load-test scenarios at 100 / 250 / 500 users | **Done** |
| **1** | **500** concurrent | Less DB write noise: throttled presence, batched scoring. Delta `lobby_state` on reconnect storms. Shared / slower session polling. Bounded lap concurrency (`LOBBY_LAP_CONCURRENCY`) | **Done** — flags on by default: `FF_BATCH_SCORING`, `FF_PRESENCE_WRITE_THROTTLE`, `FF_DELTA_LOBBY_STATE` |
| **2** | **500 → 2,000** | Redis as the control plane: Socket.IO adapter, lobby locks, presence + question ownership. Split socket nodes (transport only) from game workers (resolve / score) | **Not live** — `FF_REDIS_ADAPTER` / `FF_JOB_QUEUE` exist; scoring worker is a placeholder |
| **3** | **5,000+** | Singleton race-ingest service → Redis. Horizontally scaled socket fleet. Queued scoring + AI jobs (deterministic fallback first, Groq later). Hot leaderboards in Redis | **Designed** — see [`backend/docs/scaling-architecture.md`](./backend/docs/scaling-architecture.md) |
| **4** | **5,000 → 50,000** | Quarterly capacity model, autoscaling on socket rate / queue depth, archive old answers, canary deploys, chaos drills | **Playbook only** — [`backend/docs/scaling-playbook.md`](./backend/docs/scaling-playbook.md) |

**Exit gates:** Phase 1 = 500 users for 30+ minutes, all SLOs, under 70% CPU, no reconnect cascade after one restart. Phase 2 = 2,000 users on multiple instances with no duplicate questions or double scoring. Phase 3 = 5,000 users on SLOs; a 2× burst may slow the HUD but must not break gameplay.

Today we are still **Phase 0/1 on one free-tier box**, usually capped around **100 lobbies × 10 players**. Next real work is Phase 2 (Redis + more than one instance) when a race weekend needs it. Load tests: `cd backend && npm run loadtest:100` (also `:250`, `:500`, `:5000`). Compare `/health/scaling` to the scenario SLOs. Do not treat the scoring worker as live until the queue is actually turned on.

### 3. Deeper race IQ (when the core loop is solid)

Cut from the first spec on purpose: **Energy Battle** and **Strategy** (undercut, two-stop, fresh-tyre pace). They need cleaner signals than we trusted for MVP. They come back only when live data can resolve them as cleanly as an overtake.

Other product ideas that fit the current loop, not a rewrite:

- Richer Final Stretch / classification questions
- Season-long identity (accounts, persistent rivalries) — we still play with a local driver name
- More arcade / between-question toys
- Qualifying or sprint-specific modes beyond the current adaptive floor

None of those are scheduled until the live GP loop is boringly reliable.

### 4. Grow the room around the race

We are pre-revenue and hiring for **community and content** (social, trailer, watch-along energy), not a sales org.

- More people in public lobbies on race day
- Private lobbies as the default watch-party habit
- Home-screen install + race alerts so fans show up before lights out
- Channels: [YouTube](https://www.youtube.com/@Motorsport-IQ) · [Instagram](https://www.instagram.com/motorsport_iq) · [LinkedIn](https://www.linkedin.com/company/motorsport-iq) · motorsportiq5@gmail.com

Monetisation is **not** designed yet. Do not build paywalls, ads, or betting-shaped features unless the team explicitly asks.

---

## How to spend your first day

1. Open the [live app](https://motorsport-iq.vercel.app) and the [guide](https://motorsport-iq.vercel.app/guide). Create a private lobby, then try **Play solo** on a replay race.
2. Skim this file again, then [`AGENTS.md`](./AGENTS.md) for env vars and deploy.
3. Run backend + frontend locally. If the backend is cold on production, that is expected.
4. Pick a lane (engine, lobby, UI, live feed, community) and ask which race weekend or bug is next.

If you change backend code, Render redeploys from `main`. Frontend-only changes ship on Vercel. Schema changes need a **manual** run in the Supabase dashboard — git is not enough.

---

*Welcome to the pit wall. Read the race, then ship the next lap.*
