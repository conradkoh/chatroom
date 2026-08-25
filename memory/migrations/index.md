# Migrations

- [Chatroom event stream daemon migration](chatroom-event-stream-daemon-migration.md) — bandwidth-saving migration from Convex to daemon-local event storage
- [Chatroom event stream writer inventory](chatroom-event-stream-writers.md) — production Convex event-stream write locations and migration baseline
- [Daemon outbox consolidation](daemon-outbox-consolidation.md) — file-tree outbox architecture (coalescing checkpoints, FIFO deltas), ownership boundaries, and migration tracker
- [Task inbox machine-level migration](task-inbox-machine-level-migration.md) — machine-scoped task signals; implementation complete (PR #1471); four-stage post-migration cleanup tracker
- [Agent operational status projection](agent-operational-status-projection.md) — daemon-authoritative agent operational state via outbox + materialized Convex projection tables; phased migration tracker
- [Agent operational status daemon integration](development/agent-operational-status-daemon-integration.md) — plan to replace task-snapshot desiredState workaround with operational projection SSOT
