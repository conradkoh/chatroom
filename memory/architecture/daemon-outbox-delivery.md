---
type: decision-log
title: Daemon outbox acknowledgement and recovery
description: Commands acknowledge local outbox persistence; delivery retries and schema recovery run independently.
tags: [daemon, outbox, lifecycle, durability]
status: active
---

# Daemon outbox acknowledgement and recovery

## Contract

- `enqueue()` resolves after validation and local persistence, without awaiting the sender. Lifecycle enqueue returns `{ success: true }` as a local acknowledgement, not a backend result.
- `enqueueAndWait()` is an explicit delivery barrier. File-tree checkpoints and deltas use it because their coordinator needs the returned backend revision before updating its manifest.
- `flushNow()` attempts pending delivery immediately. Transient failures reject the flush while leaving background retries scheduled; conflicts and partial batches retain their retry timers.
- `stop()` / `stopAll()` cancel scheduling, reject delivery waiters, and preserve unsent records without waiting for network completion. Late completions cannot access a closed store. Registries replay all pending keys when created, without requiring a new command.

## Failure policy

Recovered payloads are validated before sending. Lifecycle recovery migrates the known legacy audit fields (`sessionId`, `machineId`) by removing them, then checks the complete supported shape. Unsupported payloads and explicit Convex `ArgumentValidationError` failures are quarantined. Unknown errors, including transient network/backend errors, retry with capped exponential backoff.

FIFO quarantine retains the original row with `status = 'quarantined'` and `last_error`. Coalescing quarantine archives the rejected snapshot in `coalescing_outbox_quarantine`, allowing a newer snapshot to use the same key. Quarantined records are excluded from replay. A server-rejected FIFO batch is retried individually to isolate the invalid item without dropping valid neighbors.

## Command boundaries

Spawn, stop, task injection, and shutdown completion may await local enqueue, but never delivery. A stop's audit write also runs independently. `chatroom_shutdown_complete` remains durable until projected, so backend acknowledgement can happen after reconnect while local command execution has already returned.

Native turn completion releases the local slot even if status/failure projection persistence fails. A failed task recovery can still hold the slot; that is a source-of-truth operation rather than a projection.

This decision supersedes the enqueue and shutdown semantics in the earlier [outbox consolidation migration](../migrations/daemon-outbox-consolidation.md).
