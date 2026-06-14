# MVP Race Lifecycle & Resolution Rules

## Resolution Timing
- Questions resolve only on lap completion.
- OpenF1 remains the source of truth for lap progression and track-status changes.
- Resolve active questions before evaluating new triggers on the same lap.

## Track Status Handling
| Status | Rule | Action |
| --- | --- | --- |
| `GREEN` | Normal | Trigger and resolve normally. |
| `SC` | No new questions | Cancel questions that have not locked; pause locked/active questions. |
| `VSC` | No new questions | Cancel questions that have not locked; pause locked/active questions. |
| `RED` | Hard stop | Cancel all active questions immediately. |

## Restart Rule
- After the track returns to `GREEN`, wait one full lap before triggering another question.

## Question Lifecycle
1. `TRIGGERED`: backend selected a valid structured prediction moment.
2. `LIVE`: question is visible and answerable for 45 seconds.
3. `LOCKED`: answers are closed.
4. `ACTIVE`: waiting for the lap-window outcome.
5. `RESOLVED`: deterministic outcome computed from race data.
6. `EXPLAINED`: explanation shown to clients.
7. `CLOSED`: question lifecycle complete.

## AI Role In Lifecycle
- AI can rewrite the question copy after `TRIGGERED`.
- AI can generate the final explanation after `RESOLVED`.
- AI never changes lifecycle state or outcome truth.
