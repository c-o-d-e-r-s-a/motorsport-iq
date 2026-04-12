# 🏁 MOTORSPORT IQ — Claude Code Agent Prompt (Production Ready)
> Claude Code with GLM-5 AI Agent. 

## BEFORE YOU WRITE ANY CODE — READ THIS FIRST

You are a senior fullstack engineer building **Motorsport IQ (MSP)**. Before writing any code or creating any files, you must:

1. Read `/mnt/skills/public/frontend-design/SKILL.md` — follow all instructions for UI/component work
2. Read `/mnt/skills/public/product-self-knowledge/SKILL.md` — follow all instructions before making any Anthropic API calls
3. Create `CLAUDE.md` in the project root **as your very first action** using the exact content specified in the **CLAUDE.md SECTION** at the bottom of this prompt
4. Commit `CLAUDE.md` before writing any other file

Do not skip this. Do not proceed past step 4 until all steps are complete.

---

## MISSION

Build **Motorsport IQ (MSP)** — a real-time Formula 1 prediction companion web app. Users join private lobbies, receive live race prediction questions triggered by race data, answer within 20 seconds, and compete on a live leaderboard. This is **not betting, not fantasy** — it is structured, race-driven prediction gameplay.

Read every section carefully. Implement exactly what is specified. Do not skip sections. Do not add features not listed here.

---

## TECH STACK (NON-NEGOTIABLE)

```
Frontend:   Next.js 14 (App Router) + Tailwind CSS
Backend:    Node.js + Express + Socket.io (WebSockets)
Database:   Supabase (PostgreSQL)
Hosting:    Vercel (frontend) + Railway (backend)
Data:       OpenF1 API — https://api.openf1.org/v1
AI:         Groq API — model: llama-3.3-70b-versatile
```

---

## SUBAGENT STRATEGY (FOLLOW THIS TO PREVENT CONTEXT OVERFLOW)

This is a large multi-module project. Use subagents for isolated modules. Never try to hold all context in one conversation.

Spawn subagents for:
- **engine-agent** → questionEngine, resolutionEngine, scoringEngine, derivedSignals
- **data-agent** → openf1Client, snapshotStore, RaceSnapshot builder
- **lobby-agent** → lobbyManager, lifecycleManager, Socket.io events
- **ui-agent** → all Next.js screens and components (use frontend-design skill)
- **db-agent** → Supabase schema, migrations, queries
- **ai-agent** → Groq API explanation generator (use product-self-knowledge skill)

Each subagent receives: its module scope, the relevant schema/interfaces, and the Socket.io event contract. Each returns only its finished, tested module. The main agent assembles them.

---

## SYSTEM ARCHITECTURE RULES

- **Server-authoritative.** Client NEVER calculates scores, triggers questions, or resolves outcomes
- **Clients trust server state.** On reconnect, server sends full `LobbyStateSnapshot`
- **Resolution only on lap completion.** No mid-lap micro-calculations. No per-second polling
- **One active question per lobby at a time**
- **Max ~8–10 questions per race per lobby**

---

## OPENF1 DATA INTEGRATION

Base URL: `https://api.openf1.org/v1`

### Endpoints:
```
GET /sessions     → current/upcoming session info
GET /laps         → lap-by-lap data → triggers LapComplete events
GET /position     → driver positions per lap
GET /intervals    → gapToCarAhead
GET /pit          → pit stop data
GET /car_data     → DRS/throttle signals
GET /race_control → SC, VSC, Red Flag, track status
GET /drivers      → driver metadata
```

### Polling & Rate Limit Handling:
- Poll every **10 seconds** on backend only
- Implement **exponential backoff** on 429/5xx: 10s → 20s → 40s → 80s (max)
- If feed stalls for > 30 seconds: set `dataFeedStalled = true`, pause triggering, do NOT cancel locked questions
- Log all feed failures to console with timestamp

### RaceSnapshot shape:
```typescript
interface RaceSnapshot {
  lapNumber: number;
  totalLaps: number;
  trackStatus: "GREEN" | "SC" | "VSC" | "RED";
  dataFeedStalled: boolean;
  drivers: {
    driverNumber: number;
    driverName: string;
    position: number;
    gapToCarAhead: number;       // seconds, 0 if leader
    pitStopCount: number;
    tyreCompound: string;
    tyreAge: number;             // laps on current tyre
    drsActive: boolean;
    speed: number;
  }[];
  timestamp: string;             // ISO
}
```

---

## DATABASE SCHEMA

```sql
CREATE TABLE users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  lobby_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE lobbies (
  lobby_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID REFERENCES users(user_id),
  lobby_code TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'waiting',   -- waiting | live | finished
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE question_instances (
  question_instance_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID REFERENCES lobbies(lobby_id),
  question_id TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  question_text TEXT NOT NULL,
  driver_a TEXT,
  driver_b TEXT,
  start_lap INT NOT NULL,
  window_size INT NOT NULL,
  status TEXT DEFAULT 'triggered',
  -- triggered | live | locked | active | resolved | explained | closed | cancelled
  outcome BOOLEAN,
  resolved_lap INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE answers (
  answer_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(user_id),
  question_instance_id UUID REFERENCES question_instances(question_instance_id),
  answer BOOLEAN,
  locked_timestamp TIMESTAMPTZ,
  is_no_answer BOOLEAN DEFAULT false
);

CREATE TABLE leaderboard (
  leaderboard_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id UUID REFERENCES lobbies(lobby_id),
  user_id UUID REFERENCES users(user_id),
  points INT DEFAULT 0,
  streak INT DEFAULT 0,
  correct_answers INT DEFAULT 0,
  total_answered INT DEFAULT 0,
  accuracy FLOAT DEFAULT 0.0
);
```

---

## QUESTION BANK — ALL 24 QUESTIONS

Hard-code as a static TypeScript object in `questionBank.ts`. Each entry follows this interface:

```typescript
interface QuestionDefinition {
  id: string;
  category: Category;
  difficulty: "Easy" | "Medium" | "Hard";
  questionTemplate: string;    // use [Driver A] and [Driver B] as placeholders
  windowSize: number;          // laps
  triggerConditions: TriggerCondition[];
  successCondition: string;    // description for resolutionEngine
  minLap?: number;             // earliest lap to trigger
}
```

### OVERTAKE
```
Q-OVR-01 | Medium | Window 3 | "Will [Driver A] overtake [Driver B] within the next 3 laps?"
  Trigger: gapToCarAhead <= 2.0, closingTrend = TRUE, trackStatus = GREEN
  Success: position[A] < position[B]

Q-OVR-02 | Easy | Window 2 | "Will [Driver A] close to within 1 second in the next 2 laps?"
  Trigger: gapToCarAhead between 1.0–3.0, closingTrend = TRUE
  Success: gapToCarAhead <= 1.0

Q-OVR-03 | Hard | Window 4 | "Will this battle result in an overtake before Lap +4?"
  Trigger: gapToCarAhead <= 1.5, closingTrend = TRUE
  Success: position change detected

Q-OVR-04 | Medium | Window 2 | "Will [Driver A] complete the overtake within 2 laps once within 1 second of [Driver B]?"
  Trigger: gapToCarAhead <= 1.0
  Success: position[A] < position[B]
```

### PIT WINDOW
```
Q-PIT-01 | Easy | Window 3 | "Will [Driver A] pit within the next 3 laps?"
  Trigger: tyreAge >= 15 OR pitWindowOpen = TRUE
  Success: pitStopCount increases

Q-PIT-02 | Medium | Window 5 | "Will [Driver A] extend this stint beyond Lap +5?"
  Trigger: tyreAge >= 18, pitWindowOpen = TRUE
  Success: pitStopCount unchanged at window end

Q-PIT-03 | Hard | Window 3 | "Will this pit stop result in a net position gain?"
  Trigger: pitStopCount just increased (detected within 1 lap)
  Success: position after pit cycle < position before pit

Q-PIT-04 | Medium | Window 2 | "Will this pit stop move [Driver A] into clean air?"
  Trigger: pitStopCount just increased
  Success: gapToCarAhead > 3.0 after pit
```

### ENERGY BATTLE
```
Q-ENG-01 | Medium | Window 3 | "Will energy advantage lead to an overtake within 3 laps?"
  Trigger: drsActive[attacker] = TRUE, gapToCarAhead <= 1.0
  Success: position change

Q-ENG-02 | Hard | Window 3 | "Will [Driver A] defend successfully against deployment pressure for 3 laps?"
  Trigger: gapToCarAhead <= 1.0, drsActive[carBehind] = TRUE
  Success: position unchanged after 3 laps

Q-ENG-03 | Medium | Window 3 | "Will deployment pressure reduce the gap by 1 second in 3 laps?"
  Trigger: gapToCarAhead between 1.0–2.5, drsActive = TRUE
  Success: gap reduces by >= 1.0

Q-ENG-04 | Hard | Window 3 | "Will defensive deployment prevent an overtake for the next 3 laps?"
  Trigger: gapToCarAhead <= 1.5, drsActive both = TRUE
  Success: no position change after 3 laps
```

### FINISH POSITION (minLap: 40)
```
Q-FIN-01 | Easy | "Will [Driver A] finish ahead of [Driver B]?"
  Trigger: lapNumber > 40, gap < 5.0 between them
  Success: final classificationA < classificationB

Q-FIN-02 | Medium | "Will the current podium order remain unchanged?"
  Trigger: lapNumber > 45, top 3 gap < 5.0 collectively
  Success: final P1/P2/P3 = current P1/P2/P3

Q-FIN-03 | Hard | "Will [Driver A] gain at least 2 positions before the race ends?"
  Trigger: lapNumber > 35, driver not in top 3
  Success: finalPosition <= currentPosition - 2

Q-FIN-04 | Medium | "Will [Driver A] remain in the Top 5?"
  Trigger: lapNumber > 40, driver currently P4 or P5
  Success: finalPosition <= 5
```

### STRATEGY
```
Q-STR-01 | Medium | Window 4 | "Will the undercut attempt succeed?"
  Trigger: two cars within 3s, one just pitted, other hasn't
  Success: pitted car ahead after pit cycle

Q-STR-02 | Hard | Window 4 | "Will [Driver A]'s strategy offset result in a net gain after pit cycle?"
  Trigger: pitStopCount delta = 1 between two cars
  Success: position improved vs pre-pit

Q-STR-03 | Medium | Window 5 | "Will this driver switch to a two-stop strategy?"
  Trigger: tyreAge >= 25, pitStopCount = 1
  Success: pitStopCount becomes 2

Q-STR-04 | Hard | Window 2 | "Will fresh tyres provide at least 0.7s pace advantage over 2 laps?"
  Trigger: pitStopCount just increased, tyreAge = 0
  Success: gapToCarAhead reduces by >= 0.7 OR overtake happens
```

### GAP CLOSING
```
Q-GAP-01 | Easy | Window 3 | "Will the gap reduce by 1 second within 3 laps?"
  Trigger: gapToCarAhead between 1.5–4.0, closingTrend = TRUE
  Success: gap reduces by >= 1.0

Q-GAP-02 | Medium | Window 2 | "Will the gap fall below 1 second within 2 laps?"
  Trigger: gapToCarAhead between 1.0–2.5, closingTrend = TRUE
  Success: gapToCarAhead <= 1.0

Q-GAP-03 | Hard | Window 4 | "Will tyre degradation slow [Driver A] by at least 1 second in 4 laps?"
  Trigger: tyreAge >= 20
  Success: gapToCarAhead increases by >= 1.0

Q-GAP-04 | Medium | Window 3 | "Will the chasing driver close to within 1 second in the next 3 laps?"
  Trigger: gapToCarAhead between 2.0–4.0, closingTrend = TRUE
  Success: gapToCarAhead <= 1.0
```

---

## DERIVED SIGNALS

```typescript
// Compute these every OnLapComplete, store in LobbyState
const closingTrend = currentGap < previousGap && (previousGap - currentGap) > 0.1;
const pitWindowOpen = tyreAge >= 15 && pitStopCount < expectedStops;
const tyreCliffRisk = tyreAge >= 25;
const undercutWindow = gapToCarAhead < 3.0 && pitWindowOpen;
const energyAdvantage = drsActive[attacker] && !drsActive[defender];
```

---

## QUESTION ENGINE

### Global Eligibility (runs first on every OnLapComplete)
```typescript
function checkGlobalEligibility(snapshot: RaceSnapshot, lobby: LobbyState): boolean {
  if (lobby.activeQuestion !== null) return false;
  if (snapshot.trackStatus !== "GREEN") return false;
  if (snapshot.dataFeedStalled) return false;
  if (lobby.questionCount >= 10) return false;
  if (lobby.lapsSinceLastQuestion < 1) return false;
  if (snapshot.lapNumber > snapshot.totalLaps - 4) return false; // late race guard
  return true;
}
```

### Priority Hierarchy
```
1. Pit Window      (highest)
2. Strategy
3. Overtake
4. Energy Battle
5. Gap Closing
6. Finish Position (lapNumber > 40 only)
```

### Tiebreakers (in order)
1. `tyreCliffRisk = TRUE` → force Pit over all
2. `undercutWindow = TRUE` → force Strategy over Overtake
3. Different difficulty than last question → prefer
4. Category not triggered in last 2 questions → prefer
5. Random pick

### Category Cooldowns
```typescript
const COOLDOWNS = {
  PitWindow:      3,
  Strategy:       4,
  Overtake:       4,
  EnergyBattle:   3,
  GapClosing:     3,
  FinishPosition: 6,
};
```

### Full OnLapComplete Flow
```typescript
async function OnLapComplete(snapshot: RaceSnapshot, lobby: LobbyState) {
  updateSnapshotStore(snapshot);
  updateDerivedSignals(snapshot);
  if (!checkGlobalEligibility(snapshot, lobby)) return;
  const eligibleCategories = evaluateAllTriggers(snapshot, lobby);
  if (eligibleCategories.length === 0) return;
  const selectedCategory = applyPriorityHierarchy(eligibleCategories, lobby);
  const question = selectQuestion(selectedCategory, lobby);
  const instance = await createQuestionInstance(question, snapshot, lobby);
  lobby.activeQuestion = instance.id;
  io.to(lobby.id).emit("question_event", buildQuestionPayload(instance));
  startAnswerTimer(instance, lobby); // 20 seconds
}
```

---

## QUESTION LIFECYCLE FSM

```
Triggered → Live → Locked → Active → Resolved → Explained → Closed
                                                          ↘ Cancelled (before lock only)
```

### Cancellation (before lock only):
```typescript
if (snapshot.trackStatus !== "GREEN" || snapshot.dataFeedStalled) {
  instance.status = "CANCELLED";
  io.to(lobby.id).emit("question_cancelled", { reason: "track_status" });
  lobby.activeQuestion = null;
}
```

### After lock — pause only, never cancel:
```typescript
// If SC/VSC starts after lock:
if (snapshot.trackStatus !== "GREEN") {
  pauseResolution = true; // do not cancel, do not resolve
}
// Resume on next GREEN lap
```

### Resolution check (every OnLapComplete while Active):
```typescript
if (checkSuccessCondition(snapshot, instance)) {
  instance.outcome = true;
  resolveQuestion(instance, lobby);
} else if (snapshot.lapNumber >= instance.startLap + instance.windowSize) {
  instance.outcome = false;
  resolveQuestion(instance, lobby);
}
// else: stay Active
```

---

## SCORING ENGINE

```typescript
function calculateScoreDelta(answer: boolean | null, outcome: boolean): number {
  if (answer === null) return 0;
  return answer === outcome ? 10 : -5;
}

// Streak bonuses (apply after base score):
// 3 consecutive correct → +5 bonus
// 5+ consecutive correct → +10 bonus each

// Accuracy update:
accuracy = correct_answers / total_answered * 100;
```

---

## SOCKET.IO EVENT CONTRACT

### Server → Client:
```typescript
"lobby_state"          // Full LobbyStateSnapshot on join/reconnect
"question_event"       // { questionText, category, difficulty, windowSize, startLap, instanceId }
"question_locked"      // { instanceId }
"resolution_event"     // { outcome, explanation, userScoresDelta, leaderboard }
"leaderboard_update"   // Updated standings array
"race_snapshot_update" // { lapNumber, trackStatus, positions[] } — optional display data
"question_cancelled"   // { reason }
"lobby_closed"         // Race finished
```

### Client → Server:
```typescript
"join_lobby"     // { lobbyCode: string, username: string }
"create_lobby"   // { username: string, sessionId: string }
"submit_answer"  // { instanceId: string, answer: boolean }
"start_session"  // Host only: { lobbyId: string, sessionId: string }
```

---

## AI EXPLANATION (Groq API)

> Before implementing this, read `/mnt/skills/public/product-self-knowledge/SKILL.md`

```typescript
import Groq from "groq-sdk";

const client = new Groq(); // key from GROQ_API_KEY env var

async function generateExplanation(
  question: QuestionInstance,
  snapshot: RaceSnapshot,
  outcome: boolean
): Promise<string> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `You are a Formula 1 race analyst. A prediction just resolved.

Question: "${question.questionText}"
Outcome: ${outcome ? "YES" : "NO"}
Driver A: ${question.driverA}, Position: ${getPosition(snapshot, question.driverA)}
Gap to car ahead: ${getGap(snapshot, question.driverA)}s
Tyre age: ${getTyreAge(snapshot, question.driverA)} laps
Track status: ${snapshot.trackStatus}

Write 2–4 sentences in plain language explaining WHY this outcome occurred.
Mention tyres, DRS, or strategy if relevant. No jargon.`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "";
}
```

---

## FRONTEND SCREENS

> Before building any UI, read `/mnt/skills/public/frontend-design/SKILL.md`

### Design Language
- Dark theme: background `#0a0a0a`, accent red `#e8002d`, white text
- Mobile-first, minimum touch target 44px
- Font: Inter or similar clean sans-serif
- Animated countdown ring (SVG circle stroke-dashoffset)
- Smooth state transitions (Framer Motion or CSS transitions)

### Screen 1: Home
- MSP logo + tagline
- "Create Lobby" → generates 6-char alphanumeric code
- "Join Lobby" → text input for code + username
- Username persists in localStorage

### Screen 2: Lobby
- Display lobby code prominently (copyable)
- Live player list via Socket.io
- Host: session selector dropdown (fetches from OpenF1 `/sessions`) + "Start Race" button
- Guest: "Waiting for host to start…" state

### Screen 3: Live Question Card
- Category badge (color-coded per category) + difficulty badge
- Question text (large, 20–24px, max 2 lines)
- Animated 20s countdown ring
- YES / NO large buttons
- After selection: button highlight, await lock
- After lock: "Locked in ✓" state, countdown stops
- After resolution: outcome reveal + points delta animation + AI explanation text
- Idle state: "Waiting for next moment…" with subtle lap counter

### Screen 4: Leaderboard
- Rank | Username | Points | Streak 🔥 | Accuracy %
- Animates on update (new scores slide in)
- Visible as a sidebar on desktop, tab on mobile

---

## BACKEND FOLDER STRUCTURE

```
/backend
  /src
    server.ts
    /engine
      questionEngine.ts
      questionBank.ts
      resolutionEngine.ts
      scoringEngine.ts
      derivedSignals.ts
    /data
      openf1Client.ts
      snapshotStore.ts
    /lobby
      lobbyManager.ts
      lifecycleManager.ts
    /ai
      explanationGenerator.ts
    /db
      supabaseClient.ts
  /schema
    schema.sql
  package.json
  .env.example

/frontend
  /app
    page.tsx              ← Home
    /lobby/[code]/page.tsx
    /game/[code]/page.tsx
  /components
    QuestionCard.tsx
    CountdownTimer.tsx
    Leaderboard.tsx
    LobbyRoom.tsx
  /lib
    socket.ts
    api.ts
  package.json
```

---

## ENVIRONMENT VARIABLES

```env
# Backend
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
GROQ_API_KEY=
OPENF1_BASE_URL=https://api.openf1.org/v1
PORT=4000
CORS_ORIGIN=http://localhost:3000

# Frontend
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## EDGE CASES

| Scenario | Behavior |
|---|---|
| Driver retires mid-window | outcome = FALSE immediately |
| SC/VSC before answer lock | Cancel, no points, no penalty |
| SC/VSC after answer lock | Pause resolution only, do NOT cancel |
| SC ends | Block trigger for 1 full lap |
| Data feed stall > 30s | Pause triggering + resolution; resume on data return |
| Disconnect before lock, answered | Keep answer |
| Disconnect before lock, no answer | NoAnswer |
| Disconnect after lock | Locked answer counts; points applied on resolution |
| Player joins mid-race | Start from next question, no backfill |
| Late answer (after 20s) | Reject, keep NoAnswer |
| No triggers for several laps | Allowed — do not force questions |
| lapNumber > totalLaps - windowSize | Do not trigger that question |
| OpenF1 429 rate limit | Exponential backoff, log, retry |

---

## VERIFICATION COMMANDS (run after each phase)

```bash
# Backend
npm run test           # Jest unit tests for engine logic
npm run test:e2e       # Integration tests with mock snapshot data
npm run lint           # ESLint

# Frontend
npm run build          # Next.js build — must pass with 0 errors
npm run test           # Component tests

# Database
npx supabase db push   # Apply schema migrations
```

Write tests for: resolution logic, scoring engine, derived signals, cancellation rules. Do not ship a phase without passing tests.

---

## BUILD SEQUENCE (follow exactly, in order)

1. Create `CLAUDE.md` (see below)
2. Database schema → Supabase
3. OpenF1 client + RaceSnapshot builder + polling loop
4. Question bank (all 24 questions as static data)
5. Derived signals module
6. Question engine (eligibility + priority + trigger)
7. Resolution engine (all 24 success/failure conditions)
8. Scoring engine (points + streaks + accuracy)
9. Lobby manager + Socket.io events
10. Lifecycle manager (FSM + timers + cooldowns)
11. Groq API explanation generator
12. Frontend: Home + Lobby screens
13. Frontend: Live Question Card + Countdown Timer
14. Frontend: Leaderboard
15. End-to-end test with mock race snapshot data
16. Connect live OpenF1 data, verify against a real session

---

## ACCEPTANCE CRITERIA

- [ ] Two users can create and join a lobby via 6-char code
- [ ] Host selects OpenF1 session and starts game
- [ ] Questions trigger automatically from race data
- [ ] All users see question + 20s countdown simultaneously
- [ ] Answers lock at exactly t=20s; late answers rejected
- [ ] Outcomes resolve correctly on lap completion only
- [ ] Scores: +10 correct, -5 wrong, 0 no-answer
- [ ] Leaderboard updates live after every resolution
- [ ] AI explanation appears after every resolved question
- [ ] Only 1 active question per lobby at a time
- [ ] SC/VSC cancellation works before lock
- [ ] SC/VSC pauses (not cancels) after lock
- [ ] Disconnected players receive correct score on reconnect
- [ ] No question triggers when window would exceed race end
- [ ] Max 10 questions per lobby per race
- [ ] OpenF1 rate limit handled gracefully (no crash)
- [ ] `npm run build` passes with 0 errors

---

---

# CLAUDE.md — INITIALIZE THIS AS YOUR FIRST FILE

Create `/CLAUDE.md` in the project root with exactly this content:

````markdown
# Motorsport IQ (MSP)

Real-time F1 prediction companion app. Private lobbies, live race questions, 20s answer window, server-side scoring. Not betting, not fantasy.

## Stack
- Frontend: Next.js 14 App Router + Tailwind CSS → Vercel
- Backend: Node.js + Express + Socket.io → Railway
- Database: Supabase (PostgreSQL)
- Data: OpenF1 API (https://api.openf1.org/v1) — poll every 10s, lap completion only
- AI: Anthropic Claude API, model `claude-sonnet-4-20250514`

## Commands
```bash
# Backend
cd backend && npm run dev        # Start backend (port 4000)
cd backend && npm run test       # Jest tests
cd backend && npm run lint       # ESLint

# Frontend
cd frontend && npm run dev       # Start frontend (port 3000)
cd frontend && npm run build     # Production build — must pass 0 errors
cd frontend && npm run test      # Component tests

# Database
npx supabase db push             # Apply schema migrations
```

## Architecture
```
/backend/src/engine/         ← ALL game logic lives here (server-authoritative)
/backend/src/data/           ← OpenF1 polling + RaceSnapshot
/backend/src/lobby/          ← Lobby FSM + Socket.io
/backend/src/ai/             ← Claude API explanation calls
/frontend/app/               ← Next.js pages
/frontend/components/        ← QuestionCard, CountdownTimer, Leaderboard
/schema/schema.sql           ← Source of truth for DB schema
```

## Hard Rules
- Client NEVER calculates scores, resolves outcomes, or triggers questions
- Resolution happens ONLY on lap completion (OnLapComplete) — never mid-lap
- Only ONE active question per lobby at a time
- Max 10 questions per race per lobby
- Cancel questions on SC/VSC/Red BEFORE answer lock only
- After lock: pause resolution, do NOT cancel
- NEVER commit .env files

## Gotchas
- OpenF1 returns 429 on rate limit → use exponential backoff: 10s → 20s → 40s → 80s
- `gapToCarAhead` is 0 for the race leader — filter before gap-based trigger conditions
- `trackStatus` from OpenF1 `/race_control` uses message strings, not codes — normalize to GREEN/SC/VSC/RED
- Socket.io rooms are keyed by `lobbyId` (UUID), not `lobbyCode`
- Supabase RLS must be disabled for service-role backend writes — use service key server-side only
- `claude-sonnet-4-20250514` is the correct model string — do not use other strings
- Question window guard: if `lapNumber > totalLaps - windowSize`, do not trigger that question

## Subagents
Use subagents for isolated modules. See the build prompt for the full subagent strategy.
Each subagent scope: engine | data | lobby | ui | db | ai
````

---

**That is the complete, agent-ready system.** Commit `CLAUDE.md` first, then follow the build sequence in order.
