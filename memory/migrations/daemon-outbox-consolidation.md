---
type: guide
title: Daemon outbox consolidation
---

# Daemon outbox consolidation

File-tree checkpoints use a coalescing outbox keyed by normalized working
directory. Each key is serialized independently, and newer pending checkpoint
state supersedes older state for that delivery partition.

The adapter owns the five-second rate limit through
`WORKSPACE_FILE_TREE_CHECKPOINT_OUTBOX_MIN_INTERVAL_MS`; subscription and daemon
runtime APIs do not expose interval configuration.

Shutdown does not flush pending state. The persisted manifest remains the
source of truth, so unsent pending checkpoint state is intentionally discarded
when an outbox is stopped.
