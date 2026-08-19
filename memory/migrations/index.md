# Migrations

- [Daemon assigned-task incremental sync migration](daemon-assigned-task-incremental-sync.md) — compact per-machine cursor, debounced task deltas, and removal of full-list task subscriptions
- [Chatroom event stream daemon migration](chatroom-event-stream-daemon-migration.md) — bandwidth-saving migration from Convex to daemon-local event storage
- [Chatroom event stream writer inventory](chatroom-event-stream-writers.md) — production Convex event-stream write locations and migration baseline
- [Daemon outbox consolidation](daemon-outbox-consolidation.md) — file-tree outbox architecture (coalescing checkpoints, FIFO deltas), ownership boundaries, and migration tracker
