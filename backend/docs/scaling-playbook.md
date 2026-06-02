# Live Scaling Playbook

## Capacity Tiers

- **Tier A (<=500 users)**: 1-2 backend instances, optional Redis, inline scoring fallback enabled.
- **Tier B (500-2000 users)**: Redis adapter enabled, distributed lobby locks enabled, batched scoring required.
- **Tier C (2000-5000 users)**: Dedicated worker process, job queue enabled, strict SLO alerting and canary deploys.
- **Tier D (5000+)**: Dedicated ingest service, horizontally scaled socket fleet, queue-driven background workloads.

## Autoscaling Signals

- Scale **socket nodes** on:
  - outbound `race_snapshot_update` rate
  - event loop lag
  - active socket count
- Scale **workers** on:
  - queue depth
  - `runtime.lap_complete_processing_ms` p95
  - `socket.resolution_broadcast_ms` p95

## Quarterly Capacity Review

1. Capture peak users, lobbies, answer bursts, reconnect bursts.
2. Re-run scenarios:
   - `npm run loadtest:500`
   - `npm run loadtest:5000`
3. Compare with SLOs in `/health/scaling`.
4. Update `MAX_ACTIVE_LOBBIES`, `MAX_PLAYERS_PER_LOBBY`, and worker counts.

## Chaos Drill Checklist

- Kill one socket instance during live session and verify reconnect p95 < 3s.
- Restart Redis replica/failover and verify no duplicate question transitions.
- Temporarily disable Groq responses and verify deterministic fallback explanations.
- Force DB latency spike and validate queue backpressure protects socket responsiveness.

## Data Lifecycle

- Keep hot answer/question rows in primary table.
- Archive stale sessions to historical partitions.
- Run weekly index review for `answers`, `question_instances`, `leaderboard`.
