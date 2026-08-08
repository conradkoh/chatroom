# Phase P1 — Outbox Drain

**Status:** Not started  
**Depends on:** [P0](./p0-discovery.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P1` — when off, skip drain worker startup; existing direct Convex publishers remain hot path.

---

## Goal

Wire the existing SQLite outbox (`infrastructure/persistence/outbox.ts`) to a Convex projection worker so `OutboundEvent` types already written to SQLite can be projected asynchronously with retry. Proves the daemon → outbox → Convex path before orchestration moves local.

## Prerequisites

- P0 complete.
- Familiarity with `packages/cli/src/daemon/entry/publisher-registry.ts` and `infrastructure/convex/publishers/`.

---

## Todos

### P1-T1 — Create projection module skeleton `[new]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/projection/sync-policy.ts` — export `SyncTier` enum (T0–T4), `getTierForOutboundEvent(type)`, T3 for `task.status` and message-adjacent types per discovery §3.2
- `packages/cli/src/daemon/infrastructure/projection/outbox-drain-worker.ts` — poll `listPendingOutbox`, load outbound event payload, dispatch to handler, mark done/failed
- `packages/cli/src/daemon/infrastructure/projection/convex/convex-projection-adapter.ts` — thin wrapper over existing Convex client/session
- `packages/cli/src/daemon/infrastructure/projection/index.ts` — re-exports

**Verify:**

- `pnpm --filter chatroom-cli test outbox-drain` passes (add unit tests with in-memory SQLite)
- Worker handles empty outbox without error
- Failed projection increments `attempts` and sets `status = 'failed'` after max retries

### P1-T2 — Map existing OutboundEvent types to projection handlers `[new]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/projection/convex/handlers/` — one handler per existing publisher in `infrastructure/convex/publishers/`:
  - `project-heartbeat.ts` ← `daemon-heartbeat.ts`
  - `project-task-status.ts` ← `assigned-task-status.ts`
  - `project-git-state.ts` ← `git-state.ts`
  - `project-session-lifecycle.ts` ← `session-lifecycle.ts`
  - `project-turn-output.ts` ← `turn-output.ts`
  - (remaining publishers from publisher-registry — grep `infrastructure/convex/publishers/*.ts`)
- `packages/cli/src/daemon/infrastructure/projection/convex/mappers/` — extract mutation arg mapping from existing publishers (reuse logic, don't duplicate business rules)

**Modify:**

- `packages/cli/src/daemon/infrastructure/persistence/outbox.ts` — add `markOutboxDone`, `markOutboxFailed`, `incrementOutboxAttempts` if missing

**Verify:**

- Each handler is idempotent (safe retry) — document idempotency key in handler header comment
- `pnpm --filter chatroom-cli test projection` passes
- Manual: enqueue test outbox row → worker drains → Convex row updated

### P1-T3 — Wire drain worker into daemon startup `[modify]`

**Modify:**

- `packages/cli/src/daemon/entry/start-daemon.ts` — start `outbox-drain-worker` when `DAEMON_ORCHESTRATION_P1` enabled
- `packages/cli/src/daemon/entry/deps.ts` — add projection worker deps
- `packages/cli/src/daemon/infrastructure/persistence/README.md` — document drain wiring

**Verify:**

- With flag **off**: daemon starts unchanged; no drain loop
- With flag **on**: drain loop runs; logs show batch drain activity
- `pnpm turbo run typecheck test --filter=chatroom-cli` green both flag states

### P1-T4 — Publisher registry enqueues outbox (dual-path transitional) `[modify]`

**Modify:**

- `packages/cli/src/daemon/entry/publisher-registry.ts` — when P1 flag on, after SQLite append also `enqueueOutbox`; Convex direct publish becomes fallback-only or removed per-event-type behind sub-flag

**Delete:** Nothing yet — keep direct publishers until P3+ validates projection path.

**Verify:**

- `harness.stream` events do **not** enqueue outbox (T0 — local only)
- `task.status` events enqueue with T3 tier
- Outbox row `target = 'convex'` matches existing schema

---

## Definition of done

- [ ] Outbox drain worker runs behind `DAEMON_ORCHESTRATION_P1`
- [ ] All existing `OutboundEvent` types (except T0) have projection handlers
- [ ] Offline → online: pending outbox rows drain on reconnect
- [ ] `pnpm turbo run typecheck test --filter=chatroom-cli` green
- [ ] No change to webapp behavior (projections produce same Convex state as direct publishers)

## Rollback

Disable `DAEMON_ORCHESTRATION_P1`; direct publishers remain authoritative.
