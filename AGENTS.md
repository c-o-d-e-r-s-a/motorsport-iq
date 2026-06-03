# Motorsport IQ — Project Reference

> Single source of truth for AI coding agents (Antigravity, Claude Code, Codex, etc.).

---

## 🌟 Overview

Real-time Formula 1 prediction companion web app. Users join private lobbies, receive live race prediction questions triggered by OpenF1 race data, answer within 20 seconds, and compete on a live leaderboard.

---

## 💻 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Socket.io-client |
| Backend | Node.js, Express, Socket.io, TypeScript |
| Database | Supabase (PostgreSQL) — project `rwwdnhclabuqvoxqzrcy`, region `AWS us-east-2` |
| AI | Groq API — `llama-3.3-70b-versatile` — question explanations & stat hints |
| Race Data (live) | F1 SignalR WebSocket feed |
| Race Data (replay) | OpenF1 API (`https://api.openf1.org/v1`) — historical telemetry & session listing |

---

## 🚀 Deployment

### Frontend — Vercel
- **URL**: `https://motorsport-iq.vercel.app`
- **Project**: `motorsport-iq` (`prj_95wMClNlN5dytLIiOVa9o1omuh0H`)
- **Auto-deploys**: on push to `main`
- **Deploy manually**: `vercel --prod` from `frontend/`

### Backend — Render
- **URL**: `https://motorsport-iq-backend.onrender.com`
- **Service ID**: `srv-d70utgnkijhs73c7q1a0`
- **Plan**: Free tier (hibernates after inactivity — cold start ~30-60s)
- **Auto-deploys**: on push to `main` (build: `cd backend && npm install --include=dev && npm run build`, start: `cd backend && node dist/server.js`)
- **Region**: Oregon
- **Dashboard**: `https://dashboard.render.com/web/srv-d70utgnkijhs73c7q1a0`

### Deployment History
| Date | Event |
|---|---|
| 2026-03 | Initial deploy on Railway (backend) + Vercel (frontend) |
| 2026-04 | Migrated backend from Railway → Render (free tier) |
| 2026-04 | Fixed `SUPABASE_URL` typo (`voy`/`vox` project ref mismatch) causing `TypeError: fetch failed` on lobby creation |
| 2026-05 | Live sessions migrated to F1 SignalR feed; OpenF1 retained for replay and session metadata only |

### Environment Variables — Backend (Render dashboard + `backend/.env`)
| Variable | Notes |
|---|---|
| `SUPABASE_URL` | `https://rwwdnhclabuqvoxqzrcy.supabase.co` |
| `SUPABASE_SERVICE_KEY` | Service role key — ref must match `vox` project |
| `GROQ_API_KEY` | Groq API key |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` |
| `OPENF1_BASE_URL` | `https://api.openf1.org/v1` — replay telemetry and session listing (not used for live data) |
| `PORT` | `4000` |
| `CORS_ORIGIN` | Comma-separated allowed origins |
| `ADMIN_SESSION_SECRET` | 32-char random secret |
| `ADMIN_INITIAL_PASSWORD_HASH` | bcrypt hash |
| `PRESENCE_DISCONNECT_GRACE_MS` | Default: 2 min |

### Environment Variables — Frontend (Vercel + `frontend/.env.local`)
| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SOCKET_URL` | Backend WebSocket URL (not set locally = falls back to `localhost:4000`) |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://rwwdnhclabuqvoxqzrcy.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |

---

## 🚨 Critical Notes

- **Always use `npm`** (never yarn/pnpm).
- **Server-authoritative**: client NEVER calculates scores or outcomes.
- **Resolution only on lap completion** — no mid-lap resolves.
- **Reconnection** must restore state via `lobby_state` event.
- **Supabase free tier** may pause after inactivity — resume from dashboard before testing.
- **Render free tier** hibernates — cold starts take 30-60s; home page shows a warming-up banner after 4s.

---

## 📂 Project Structure

```
motorsport-iq/
├── frontend/                        # Next.js 16 app
│   └── src/
│       ├── app/
│       │   ├── page.tsx             # Landing / lobby join page
│       │   ├── lobby/[code]/        # Waiting room
│       │   ├── game/[code]/         # Main game UI
│       │   └── admin/               # Admin dashboard
│       ├── components/              # UI components
│       └── lib/
│           ├── socket.ts            # Socket.io singleton
│           ├── types.ts             # Shared types (mirrors backend)
│           └── backendUrl.ts        # Env-based URL resolution
├── backend/
│   └── src/
│       ├── server.ts                # Express + Socket.io entry point
│       ├── types.ts                 # Shared TypeScript types
│       ├── engine/                  # Game logic (server-authoritative)
│       │   ├── questionEngine.ts    # Question selection / eligibility
│       │   ├── questionBank.ts      # Question templates
│       │   ├── resolutionEngine.ts  # Outcome determination
│       │   ├── scoringEngine.ts     # Points calculation
│       │   └── derivedSignals.ts    # Race state analysis
│       ├── lobby/                   # Room & state management
│       │   ├── lobbyManager.ts      # CRUD + in-memory cache
│       │   ├── lifecycleManager.ts  # Question state machine
│       │   └── presenceManager.ts   # Connection tracking & timeouts
│       ├── runtime/                 # Session execution
│       │   ├── sessionRuntimeManager.ts  # Live vs Replay coordination
│       │   └── replayTimeline.ts    # Replay playback control
│       ├── data/                    # External integrations
│       │   ├── f1SignalRClient.ts   # Live F1 SignalR feed
│       │   ├── f1Calendar.ts        # Hardcoded weekend calendar fallback
│       │   ├── openf1Client.ts      # OpenF1 API client (replay + session lookup)
│       │   └── snapshotStore.ts     # Race state persistence
│       ├── ai/                      # AI generation
│       │   ├── explanationGenerator.ts
│       │   └── statHintGenerator.ts
│       └── admin/                   # Admin panel
│           ├── auth.ts
│           └── reporting.ts
└── .agent/skills/f1-engine/         # Antigravity skill — game mechanics rules
```

---

## 📡 Socket.io Events

**Server → Client:**
`lobby_state`, `question_event`, `question_text_update`, `question_state`, `question_locked`, `question_cancelled`, `resolution_event`, `leaderboard_update`, `race_snapshot_update`, `feed_status`, `presence_expired`, `sessions_list`, `player_joined`, `player_left`, `player_disconnected`, `player_reconnected`, `error`

**Client → Server:**
`create_lobby`, `join_lobby`, `leave_lobby`, `start_session`, `start_simulation`, `submit_answer`, `reconnect_lobby`, `presence_ping`, `get_sessions`

---

## 🎮 Question Lifecycle

```
TRIGGERED (1s) → LIVE (20s answer window) → LOCKED → ACTIVE → RESOLVED → EXPLAINED
```

**Engine guardrails:**
- One active question per lobby at a time
- Max 8-10 questions per race
- No questions on laps 1-3
- No triggers during SC/VSC/RED flag
- 1-lap cooldown after restarts, 2-lap cooldown after resolution
- No consecutive same-category questions

**Categories:** `OVERTAKE`, `PIT_WINDOW`, `GAP_CLOSING`, `FINISH_POSITION`

---

## 🏎️ Specialized Logic (Antigravity Skill)

Detailed race mechanics are in `.agent/skills/f1-engine/`:
- `rules/race-lifecycle.md` — SC/VSC handling
- `rules/triggers.md` — `closingTrend` and `pitWindow` signals
- `rules/scoring.md` — points and streak bonuses

---

## 🗄️ Database Schema

Key tables: `lobbies`, `users`, `leaderboard`, `questions`, `answers`, `problem_reports`

See `backend/schema/` for full SQL definitions.

---

## 🔧 Common Commands

```bash
# Frontend
cd frontend && npm run dev

# Backend
cd backend && npm run dev
cd backend && npm run test
cd backend && npm run test -- src/engine/questionEngine.test.ts

# Deploy frontend
vercel --prod

# View Render logs
render logs -r srv-d70utgnkijhs73c7q1a0 --output text --limit 50
```