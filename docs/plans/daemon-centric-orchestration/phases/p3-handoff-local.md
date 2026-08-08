# Phase P3 — Handoff Local

**Status:** Not started  
**Depends on:** [P2](./p2-local-read-models.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P3` — when off, `chatroom handoff` uses Convex `messages.handoff`.

---

## Goal

Route `chatroom handoff` through daemon HTTP on localhost. Daemon executes handoff invariants locally (SQLite transaction), updates read models, enqueues T3 projection. Breaks the CLI → Convex → signal → daemon loop.

## Prerequisites

- P2 read models for tasks, participants, handoffs.
- Review `services/backend/convex/messages.ts` handoff mutation for invariants to replicate locally.

---

## Todos

### P3-T1 — Domain events and handoff use case `[new]`

**Implement:**

- `packages/cli/src/daemon/domain/events/handoff-completed.ts`
- `packages/cli/src/daemon/domain/events/index.ts` — `DomainEvent` union
- `packages/cli/src/daemon/domain/value-objects/ids.ts` — TaskId, ChatroomId, Role
- `packages/cli/src/daemon/domain/errors/index.ts` — HandoffRejected, etc.
- `packages/cli/src/daemon/application/ports/handoff.port.ts`
- `packages/cli/src/daemon/application/ports/event-store.port.ts`
- `packages/cli/src/daemon/application/use-cases/handoff/execute-handoff.ts` — replicate `messages.handoff` steps locally:
  1. Validate classification rules
  2. Complete in_progress tasks
  3. Insert handoff message
  4. Create target task (if not user)
  5. Update sender participant to waiting
  6. Promote queued → pending
- `packages/cli/src/daemon/application/use-cases/handoff/complete-handoff-to-user.ts`

**Verify:**

- Unit tests cover: handoff to user, handoff to builder, rejected handoff, enhancer enqueue path
- Local SQLite transaction rolls back on invariant failure (no partial state)

### P3-T2 — CLI HTTP server for handoff `[new]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/inbound/local/cli-http-server.ts` — HTTP server on localhost (port from config)
- `packages/cli/src/daemon/infrastructure/inbound/local/routes/handoff.route.ts` — POST `/handoff` body matches CLI options
- `packages/cli/src/daemon/infrastructure/inbound/local/cli-http-server.test.ts`
- `packages/cli/src/daemon/entry/command-router.ts` — dispatch HTTP → use cases

**Modify:**

- `packages/cli/src/daemon/entry/start-daemon.ts` — start cli-http-server
- `packages/cli/src/daemon/entry/deps.ts` — wire handoff use case

**Verify:**

- `curl -X POST localhost:<port>/handoff` with valid session returns 200
- Invalid chatroom returns structured error matching CLI error shape

### P3-T3 — Convex projection for handoff `[new]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/projection/convex/handlers/project-handoff.ts`
- `packages/cli/src/daemon/infrastructure/projection/convex/mappers/handoff.mapper.ts`
- `services/backend/convex/messages.ts` — add idempotent `projectHandoffFromDaemon` mutation (or equivalent) called by projection worker only

**Modify:**

- `packages/cli/src/daemon/infrastructure/persistence/event-store.ts` — append `DomainEvent` alongside/instead of `OutboundEvent` for handoff

**Delete:** Nothing yet — keep `messages.handoff` mutation for flag-off path.

**Verify:**

- `pnpm --filter @workspace/backend test handoff` passes (add projection idempotency test)
- Webapp shows handoff message within T3 SLA
- Re-projection with same idempotency key is no-op

### P3-T4 — CLI handoff command calls daemon HTTP `[modify]`

**Modify:**

- `packages/cli/src/commands/handoff/index.ts` — when `DAEMON_ORCHESTRATION_P3` on, POST to daemon HTTP instead of `api.messages.handoff`
- `packages/cli/src/commands/handoff/deps.ts` — add daemon HTTP client
- `packages/cli/src/commands/handoff/handoff.test.ts` — test both paths

**Verify:**

- Flag off: existing Convex handoff unchanged
- Flag on: handoff completes without `messages.handoff` Convex call (mock/assert)
- End-to-end: planner handoff → builder receives task via existing delivery path

### P3-T5 — Stop relying on assigned-task signal for handoff delivery `[shrink]`

**Modify:**

- `packages/cli/src/daemon/entry/native-delivery/` — when P3 on, delivery triggered from local handoff event, not `assigned-task.signal` subscriber

**Verify:**

- `pnpm --filter chatroom-cli test native-delivery` passes
- Handoff → delivery without `assigned-task-signals` subscriber firing (P3+P5 combo; can stub in P3)

---

## Definition of done

- [ ] `chatroom handoff` with P3 on writes SQLite first, projects to Convex
- [ ] No `messages.handoff` on hot path when P3 on
- [ ] Webapp handoff UX unchanged
- [ ] `pnpm turbo run typecheck test --filter=chatroom-cli --filter=@workspace/backend` green

## Rollback

Disable `DAEMON_ORCHESTRATION_P3`; CLI reverts to Convex handoff.
