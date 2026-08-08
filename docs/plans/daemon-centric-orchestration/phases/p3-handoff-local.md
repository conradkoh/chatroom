# Phase P3 — Handoff Local

**Status:** Not started  
**Depends on:** [P2](./p2-local-read-models.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P3` — when off, `chatroom handoff` uses Convex `messages.handoff`.

## Shippability

**Shippable alone:** Yes — with P2 complete (read models for handoff invariants); P4/P5/P6 not required.

### What ships

- Daemon HTTP endpoint for handoff
- Local handoff execution (SQLite SSOT) + T3 projection to Convex
- CLI `chatroom handoff` routes to daemon when P3 on

### Flag-off guarantee

`chatroom handoff` continues to call `api.messages.handoff` — identical to today.

### Progressive rollout

1. **P3 on:** CLI → daemon HTTP → local handoff → projection. Convex `messages.handoff` not called. Assigned-task signal subscriber may still fire from projection (acceptable until P5).
2. **Optional (`DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY` on):** Native delivery triggered from local handoff event instead of `assigned-task.signal`. Ship separately from core P3; not required for P3 merge.

### Toward outcome

Breaks the largest CLI → Convex → signal → daemon loop. Handoff is locally authoritative.

### Ship checklist

- [ ] Flag off: handoff via Convex unchanged; existing tests pass
- [ ] Flag on: planner → builder handoff E2E (task created, message visible in webapp)
- [ ] Idempotent projection: replay handoff event is no-op
- [ ] P3_LOCAL_DELIVERY (if enabled): delivery without waiting for assigned-task signal

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

### P3-T5 — Local delivery from handoff event (optional sub-flag) `[shrink]`

**Modify:**

- `packages/cli/src/daemon/entry/native-delivery/` — when `DAEMON_ORCHESTRATION_P3_LOCAL_DELIVERY` on, delivery triggered from local handoff event, not `assigned-task.signal` subscriber

**Note:** This todo is **optional within P3**. P3 is shippable without it. Full signal removal happens in P5.

---

## Definition of done

- [ ] `chatroom handoff` with P3 on writes SQLite first, projects to Convex
- [ ] No `messages.handoff` on hot path when P3 on
- [ ] Webapp handoff UX unchanged
- [ ] `pnpm turbo run typecheck test --filter=chatroom-cli --filter=@workspace/backend` green

## Rollback

Disable `DAEMON_ORCHESTRATION_P3`; CLI reverts to Convex handoff.
