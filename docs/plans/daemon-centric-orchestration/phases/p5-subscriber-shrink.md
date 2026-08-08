# Phase P5 — Subscriber Shrink

**Status:** Not started  
**Depends on:** [P3](./p3-handoff-local.md), [P4](./p4-lifecycle-local.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P5` — when off, full 16-subscriber registry remains.

---

## Goal

Remove orchestration-related Convex WS subscribers. Daemon no longer subscribes to self-projected state. Keep only **user-intent inbound** (files, git, webapp commands, workspace list).

## Prerequisites

- P3 handoff local verified end-to-end.
- P4 lifecycle local verified end-to-end.

---

## Todos

### P5-T1 — Move user-intent subscribers to inbound/convex `[migrate]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/inbound/convex/user-intent-subscribers.ts`
- `packages/cli/src/daemon/infrastructure/inbound/convex/subscriber-registry.ts` — registers only:
  - `git-request.ts`
  - `file-tree-request.ts`
  - `file-content-request.ts`
  - `file-write-request.ts`
  - `workspace-list.ts`
  - `command-events.ts` (webapp-initiated)
  - `command-run.ts` (if webapp-initiated — verify)
  - `direct-harness-*` (sessions from webapp)
  - `agentic-query-*` (webapp-initiated)

**Modify:**

- `packages/cli/src/daemon/entry/start-daemon.ts` — use inbound subscriber registry when P5 on

**Verify:**

- File/git fulfillment still works from webapp
- Direct harness web sessions still drain

### P5-T2 — Remove orchestration subscribers `[delete]`

**Delete (registration, when P5 on):**

- `packages/cli/src/daemon/infrastructure/convex/subscribers/assigned-task-signals.ts` — stop registering
- `packages/cli/src/daemon/infrastructure/convex/subscribers/assigned-task-presence.ts` — stop registering
- `packages/cli/src/daemon/infrastructure/convex/subscribers/enhancer-job.ts` — stop registering

**Modify:**

- `packages/cli/src/daemon/entry/subscriber-registry.ts` — `[shrink]` to re-export inbound registry or delete when P5 complete
- `packages/cli/src/daemon/entry/event-router.ts` — remove routes for deleted inbound event types

**Verify:**

- Grep `assigned-task.signal` handler — only used in tests or flag-off path
- `pnpm --filter chatroom-cli test subscriber-registry` passes
- Handoff → delivery works with signals subscriber disabled

### P5-T3 — Shrink publisher registry `[shrink]`

**Modify:**

- `packages/cli/src/daemon/entry/publisher-registry.ts` — becomes local event bus: append to event store + enqueue projection only (no direct Convex publish)

**Delete:**

- Direct Convex publisher calls in `infrastructure/convex/publishers/` from hot path (files remain as reference until P6)

**Verify:**

- All outbound orchestration events flow: use case → event store → outbox → projection
- `harness.stream` stays T0 (no Convex)

### P5-T4 — Update documentation `[modify]`

**Modify:**

- `packages/cli/src/daemon/infrastructure/convex/subscribers/README.md` — mark orchestration subscribers removed
- `packages/cli/src/daemon/README.md` — update architecture diagram

**Verify:**

- README reflects inbound-only Convex subscription model

---

## Definition of done

- [ ] ≤10 inbound subscribers (user-intent only); assigned-task signals/presence not registered
- [ ] No daemon subscription to self-projected orchestration state
- [ ] Full handoff → delivery → lifecycle flow works with P5 on
- [ ] `pnpm turbo run typecheck test --filter=chatroom-cli` green

## Rollback

Disable `DAEMON_ORCHESTRATION_P5`; restore full `subscriber-registry.ts`.
