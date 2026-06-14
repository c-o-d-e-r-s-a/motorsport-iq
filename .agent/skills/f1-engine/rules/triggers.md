# MVP Question Triggers & Signals

## Allowed Categories
1. `OVERTAKE`
2. `PIT_WINDOW`
3. `GAP_CLOSING`
4. `FINISH_POSITION`

Anything outside these four categories is out of MVP scope.

## Derived Signals
- `ClosingTrend`: interval to the car ahead decreases across consecutive laps.
- `WithinOneSecond`: interval to the car ahead is `<= 1.0s`.
- `OvertakeOpportunity`: close battle plus `ClosingTrend`.
- `PitWindowOpen`: tyre age is within roughly 3 laps of the expected stint end.
- `TyreCliffRisk`: tyre age is high and lap time drops significantly.
- `LateRacePhase`: at least 60% of race distance complete.
- `PodiumStabilityTrend`: top-three order and gaps stay stable over recent laps.

## Global Guardrails
- Maximum 1 active question per lobby.
- GP pacing targets a minimum of 8 and maximum of 15 questions.
- Sprint-length races use a lower adaptive pacing floor because the race is shorter.
- No questions on laps `1-3`.
- No questions while `SC`, `VSC`, or `RED` is active.
- Enforce a 1-lap cooldown after restart.
- Do not trigger the same category twice in a row.
- Enforce a 2-lap cooldown after resolution.
- Only use 2-lap or 3-lap prediction windows.
- `FINISH_POSITION` / Final Stretch prompts must stay in the final ~15% of race distance.

## Trigger Priority
1. `OVERTAKE`
2. `PIT_WINDOW`
3. `GAP_CLOSING`
4. `FINISH_POSITION`

## Category Mapping
- `OVERTAKE`
  - Use when a trailing car is closing quickly and is already in near-overtake range.
- `PIT_WINDOW`
  - Use when tyre age or stint profile indicates an imminent stop or a likely stay-out decision.
- `GAP_CLOSING`
  - Use when a chaser is compressing the interval but no stronger overtake trigger exists.
- `FINISH_POSITION`
  - Use only in `LateRacePhase`.
