# Load Test Scenarios

Machine-readable profiles for staging capacity checks before live race weekends.

## Capacity findings (Jun 2026, local dev)

Tests used `loadtest/harness.js` against a server with fallback caps raised (`MAX_ACTIVE_LOBBIES` / `MAX_PLAYERS_PER_LOBBY` set very high) and `SIMULATION_ENABLED=true`. Each simulated lobby runs its own question runtime (independent of other lobbies).

| Target | “Good UX” (snappy joins) | Hard ceiling (errors &lt; ~2%) |
|--------|--------------------------|----------------------------------|
| Players in **one** lobby | ~**30** (join p95 &lt; ~3s) | ~**785–828** (Supabase `fetch failed`, timeouts) |
| **Many** lobbies (10 users each) | Not fully profiled at high scale | At least **800 lobbies** / **8,000** users in burst tests with 0% failures |

Configured fallbacks (`MAX_PLAYERS_PER_LOBBY=75`, `MAX_ACTIVE_LOBBIES=500`) were **not** the first bottleneck on this machine. **Supabase + total concurrent sockets** (~8k+) were.

**Production (Render free tier):** plan conservatively (~25–30 players/lobby, ~50–100 lobbies) until you run the same harness against staging/production.

## Quick capacity smoke (~2–3 min)

**1. Start an unlimited-cap test server** (port 4001, leaves normal dev on 4000):

```powershell
# From backend/
.\loadtest\start-unlimited-server.ps1
```

**2. In another terminal**, run a single-shot probe (not a long binary ramp):

```powershell
cd backend
$env:LOADTEST_URL = "http://localhost:4001"

# 100 lobbies × 10 users = 1,000 concurrent connections (~1–2 min)
node loadtest/harness.js --mode lobbies --target 100 --users-per-lobby 10

# Optional: one big lobby (~1 min)
node loadtest/harness.js --mode players --target 100
```

**3. Check server metrics:**

```powershell
curl.exe -s http://localhost:4001/health/scaling
```

### Full capacity search (slow — 30+ min)

```powershell
$env:LOADTEST_URL = "http://localhost:4001"
node loadtest/harness.js --mode capacity-players      # binary search, one lobby
node loadtest/harness.js --mode capacity-lobbies --users-per-lobby 10
```

Pass criteria default to **failure-only** (≤2% errors). For strict latency SLOs too:

```powershell
$env:LOADTEST_STRICT_SLO = "true"
node loadtest/harness.js --mode capacity-players
```

### Harness reference

| Flag / env | Purpose |
|------------|---------|
| `LOADTEST_URL` | Backend base URL (default `http://localhost:4000`) |
| `LOADTEST_STRICT_SLO=true` | Also fail on join/create p95 latency |
| `LOADTEST_JOIN_CONCURRENCY` | Parallel joins per lobby (default 40) |
| `LOADTEST_LOBBY_CONCURRENCY` | Parallel lobby spawns (default 15) |
| `--mode lobbies --target N` | Fast single probe |
| `--mode capacity-lobbies` | Slow binary search for max lobbies |

## Scenarios

| File | Users | Lobbies | Purpose |
|------|-------|---------|---------|
| `scenario-100-live.json` | 100 | 10 | Baseline smoke |
| `scenario-250-live.json` | 250 | 25 | Pre-production gate |
| `scenario-500-live.json` | 500 | 50 | Primary milestone |
| `scenario-5000-live.json` | 5000 | 500 | Stretch target |

## Usage

From `backend/`:

```bash
# Print scenario targets and SLO gates
npm run loadtest:100
npm run loadtest:250
npm run loadtest:500
npm run loadtest:5000

# Evaluate captured metrics against SLO gates
curl -s http://localhost:4000/metrics > /tmp/metrics.json
node loadtest/runSummary.js loadtest/scenario-500-live.json /tmp/metrics.json
```

Exit code `0` = all evaluated SLOs pass; `1` = at least one failure.

## SLO gates (all scenarios)

- `questionEventP95Ms` → `socket.question_event_delivery_ms` p95
- `submitAnswerAckP95Ms` → `socket.submit_answer_ms` p95
- `resolutionPublishP95Ms` → `socket.resolution_broadcast_ms` p95
- `reconnectRecoveryP95Ms` → `socket.reconnect_recovery_ms` p95

`criticalEventDropRatePct` requires an external harness with drop counters.

## Staging checklist

1. Apply `update_leaderboard_batch` migration from `schema/schema.sql`.
2. Enable Phase 1 flags (`FF_BATCH_SCORING`, `FF_PRESENCE_WRITE_THROTTLE`, `FF_DELTA_LOBBY_STATE`).
3. Run harness at target concurrency for scenario duration.
4. Compare `/health/scaling` metrics with scenario SLOs via `runSummary.js`.
