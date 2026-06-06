# Motorsport IQ Project Rules

## MVP Product Loop
- OpenF1 provides the factual race feed.
- The backend builds lap-based `RaceSnapshot` state and derived signals.
- The server selects one valid prediction moment at a time.
- Groq/Llama may rewrite the question copy and generate the final explanation text.
- The server locks answers, resolves outcomes from race data only, and updates scores and leaderboard state.

## MVP Question Categories
- `OVERTAKE`
  Example: "Will Driver A overtake Driver B within the next 3 laps?"
- `PIT_WINDOW`
  Example: "Will Driver A pit within the next 3 laps?"
- `GAP_CLOSING`
  Example: "Will the gap reduce by 1 second within 3 laps?"
- `FINISH_POSITION`
  Example: "Will Driver A finish ahead of Driver B?"

## RaceSnapshot Rules
- Snapshot evaluation is lap-based, not freeform continuous telemetry reasoning.
- Core snapshot fields:
  - `lapNumber`
  - `totalLaps`
  - `trackStatus`
  - `timestamp`
  - per-driver position, interval, gap to leader, tyre compound, tyre age, last lap time, and pit count
- Hidden energy systems, fuel modes, and opaque race-engineering inputs are out of MVP scope.

## Derived Signals
- `ClosingTrend`: interval to the car ahead decreases across consecutive laps.
- `WithinOneSecond`: interval to the car ahead is `<= 1.0s`.
- `OvertakeOpportunity`: `WithinOneSecond` or near-DRS range plus `ClosingTrend`.
- `PitWindowOpen`: tyre age is near expected stint end.
- `TyreCliffRisk`: tyre age is high and lap time drops sharply.
- `LateRacePhase`: current lap is at least 60% of race distance.
- `PodiumStabilityTrend`: top-three order and gaps stay broadly stable across recent laps.
- `TrackGreenOnly`: questions only trigger when the track is green.

## Engine Guardrails
- One active question per lobby.
- Minimum `8`, maximum `15` questions per race (same for Sprint and GP).
- No new questions on laps `1-3`.
- No triggers during `SC`, `VSC`, or `RED`.
- Enforce a 1-lap cooldown after a restart.
- Do not ask the same category twice in a row.
- Enforce a 2-lap cooldown after a question resolves.
- Question windows are only `2` or `3` laps in MVP.
- Resolution remains server-authoritative and deterministic.

## AI Responsibilities
- Groq/Llama is allowed to:
  - rewrite the selected prediction into player-facing copy
  - generate the post-resolution explanation
- Groq/Llama is not allowed to:
  - decide whether a question should trigger
  - decide whether an outcome is true
  - calculate scores or ranks
- If Groq/Llama fails, the game must fall back to deterministic template text.

## Runtime Modes
- `replay`
  - preload completed-race data
  - replay from the green flag at `10x`
  - apply the same trigger and resolution rules as live
- `live`
  - continuously poll OpenF1
  - trigger questions from the same deterministic event rules

## Detailed Engine Reference
- The subsystem-level implementation guidance lives in [.agent/skills/f1-engine/SKILL.md](/Users/shuknuk/Developer/motorsport-iq/.agent/skills/f1-engine/SKILL.md).
- Keep that skill aligned with this project-wide ruleset whenever engine behavior changes.

## Deployment Check Before Git Push
- Whenever pushing changes to Git, explicitly check whether the diff includes backend code, frontend code, database/schema changes, or environment-variable changes.
- If `backend/` changed, assume Railway backend redeploy is required and call that out in the handoff.
- If only `frontend/` changed, call out the frontend deployment requirement for the hosting target in the handoff.
- If `backend/schema/`, Supabase SQL, RLS policies, database functions, or Supabase-related env vars changed, call out that Supabase changes must also be applied.
- If no schema or Supabase config changed, explicitly state that no Supabase action is required.
