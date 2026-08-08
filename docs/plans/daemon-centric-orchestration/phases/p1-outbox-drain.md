# Phase P1 — Outbox Drain

**Status:** Implemented (in review) — stacked PRs [#1341](https://github.com/conradkoh/chatroom/pull/1341) → [#1342](https://github.com/conradkoh/chatroom/pull/1342) → [#1343](https://github.com/conradkoh/chatroom/pull/1343) on docs base [#1340](https://github.com/conradkoh/chatroom/pull/1340)  
**Depends on:** [P0](./p0-discovery.md)  
**Feature flags:** `DAEMON_ORCHESTRATION_P1` (drain worker) · `DAEMON_ORCHESTRATION_P1_CUTOVER` (sole Convex write path) — both default **off**

## Shippability

**Shippable alone:** Yes — with P0 complete; no later phase required.

### What ships

- Async Convex projection infrastructure (outbox drain worker, shared routing, retry)
- Offline → online catch-up for outbound events (when cutover enabled)
- Foundation for all later phases (no orchestration moves yet)

### Flag-off guarantee

Daemon starts unchanged. No drain loop. Publisher registry uses direct Convex publish only (today's behavior).

### Progressive rollout

1. **Shadow (`DAEMON_ORCHESTRATION_P1=1`, cutover off):** `persistence-store` enqueues non-T0 events to outbox. Drain worker validates a projection handler exists (`assertProjectableEvent`) and marks rows done — **does not call Convex**. Direct publishers remain the sole Convex writers.
2. **Cutover (`DAEMON_ORCHESTRATION_P1_CUTOVER=1`):** Drain worker calls Convex via existing publisher factories. Publisher-registry skips direct publish for event types with handlers. Ship cutover only after shadow soak (≥1 week dev usage or explicit sign-off).

### Toward outcome

Proves daemon → SQLite → outbox → Convex projection path with retry — prerequisite for moving orchestration local without Convex round-trips.

### Ship checklist

- [x] Code merged path: `pnpm turbo run typecheck test --filter=chatroom-cli` green (283 files / 2226 tests on `feat/daemon-orchestration-p1-3-integration`)
- [ ] PRs merged: #1340 → #1341 → #1342 → #1343
- [ ] Flag off: manual smoke (handoff, delivery) unchanged in dev
- [ ] Flag on, cutover off: shadow drain runs; Convex receives writes only from direct publish (no duplicates)
- [ ] Flag on, cutover on: no duplicate Convex mutations for covered event types
- [ ] Offline soak: pending outbox rows drain on reconnect (cutover mode)

---

## Goal

Wire the existing SQLite outbox (`infrastructure/persistence/outbox.ts`) to a Convex projection worker so `OutboundEvent` types already written to SQLite can be projected asynchronously with retry. Proves the daemon → outbox → Convex path before orchestration moves local.

## Prerequisites

- P0 complete.
- Familiarity with `packages/cli/src/daemon/entry/publisher-registry.ts` and `infrastructure/convex/publishers/`.

---

## Stacked PRs (as built)

| PR                                                       | Branch                                                   | Scope                                    |
| -------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| [#1340](https://github.com/conradkoh/chatroom/pull/1340) | `docs/daemon-centric-orchestration-discovery` → `master` | Plan docs (discovery, overview, phases)  |
| [#1341](https://github.com/conradkoh/chatroom/pull/1341) | `feat/daemon-orchestration-p1-1-foundation`              | P1-T1 + outbox helpers + T0 enqueue skip |
| [#1342](https://github.com/conradkoh/chatroom/pull/1342) | `feat/daemon-orchestration-p1-2-handlers`                | P1-T2 routing extraction                 |
| [#1343](https://github.com/conradkoh/chatroom/pull/1343) | `feat/daemon-orchestration-p1-3-integration`             | P1-T3 + P1-T4 wiring                     |

**Merge order:** #1340 → #1341 → #1342 → #1343

---

## Implementation artifacts

```
packages/cli/src/daemon/infrastructure/projection/
├── feature-flags.ts              # isDaemonOrchestrationP1Enabled, isDaemonOrchestrationP1CutoverEnabled
├── sync-policy.ts                # SyncTier, getTierForOutboundEvent, shouldEnqueueOutbox
├── outbox-drain-worker.ts        # drainOutboxOnce, startOutboxDrainWorker
├── index.ts                      # barrel re-exports
└── convex/
    ├── route-outbound-event.ts   # createConvexPublishers, getConvexEventHandler, routeConvexEvent, assertProjectableEvent
    └── convex-projection-adapter.ts  # createConvexProjectionAdapter

packages/cli/src/daemon/infrastructure/persistence/
├── event-store.ts                # + loadOutboundEventById
├── outbox.ts                     # + markOutboxDone, markOutboxFailed, incrementOutboxAttempts
├── persistence-store.ts          # T0 skip on enqueue; exposes db handle for drain worker
└── README.md                     # flag matrix

packages/cli/src/daemon/entry/
├── publisher-registry.ts         # imports shared routing; cutover skips direct Convex
└── start-daemon.ts               # starts/stops drain worker when P1 enabled
```

**Design choice:** No per-event `handlers/` or `mappers/` files — projection reuses existing `create*Publisher` factories from `infrastructure/convex/publishers/` via `route-outbound-event.ts` (single routing table).

**Event types with handlers:** heartbeat, turn.chunk, turn.completed, session.lifecycle, task.status, git.state, capabilities.updated, models.updated, harness.fingerprint.updated, command.result.\*, workspace.commands. **Excluded (T0):** harness.stream.

---

## Todos

### P1-T1 — Projection foundation `[done]` — PR #1341

**Shipped:**

- `projection/feature-flags.ts`, `sync-policy.ts`, `outbox-drain-worker.ts`, `index.ts`
- `persistence/event-store.ts` — `loadOutboundEventById`
- `persistence/outbox.ts` — `markOutboxDone`, `markOutboxFailed`, `incrementOutboxAttempts`
- `persistence/persistence-store.ts` — `shouldEnqueueOutbox` gate (skips `harness.stream`); exposes `db`
- `projection/outbox-drain-worker.test.ts`, extended `outbox.test.ts`, `persistence-store.test.ts`

**Verify:** `pnpm --filter chatroom-cli test outbox-drain outbox persistence-store`

### P1-T2 — Shared Convex routing `[done]` — PR #1342

**Shipped:**

- `projection/convex/route-outbound-event.ts` — extracted from publisher-registry; `getConvexEventHandler` for cutover check without double invocation
- `projection/convex/convex-projection-adapter.ts` — `project` + `validateProjectable`
- `publisher-registry.ts` — imports shared routing (no behavior change in PR2)
- `projection/convex/route-outbound-event.test.ts` — all types routed except harness.stream

**Verify:** `pnpm --filter chatroom-cli test route-outbound-event publisher-registry`

**Not built (by design):** separate `handlers/` and `mappers/` directories — publishers are the handlers.

### P1-T3 — Daemon startup wiring `[done]` — PR #1343

**Shipped:**

- `start-daemon.ts` — `startOutboxDrainWorker` when `DAEMON_ORCHESTRATION_P1` enabled; `stop()` in `finally`
- `persistence/README.md` — flag matrix documentation
- `start-daemon.test.ts` — worker starts with flag, not by default

**Not modified:** `deps.ts` (worker deps wired directly in start-daemon)

**Verify:** `pnpm --filter chatroom-cli test start-daemon`

### P1-T4 — Cutover skip in publisher-registry `[done]` — PR #1343

**Shipped:**

- `publisher-registry.ts` — when `DAEMON_ORCHESTRATION_P1_CUTOVER` on and handler exists, skip direct Convex publish (drain is sole writer)
- `publisher-registry.test.ts` — cutover skip, default direct publish, harness.stream never convex

**Not in publisher-registry:** outbox enqueue (already in `persistence-store.append` since before P1; P1 only added T0 skip)

**Verify:** cutover test asserts direct publish skipped; shadow asserts drain does not call `projectEvent`

---

## Definition of done

- [x] Outbox drain worker implemented behind `DAEMON_ORCHESTRATION_P1`
- [x] All existing `OutboundEvent` types (except T0) routable via shared routing table
- [x] Shadow mode shippable without cutover sub-flag (validate-only drain)
- [x] Cutover sub-flag documented and gated behind soak checklist
- [x] `pnpm turbo run typecheck test --filter=chatroom-cli` green on implementation branch
- [ ] PRs merged to main/docs branch
- [ ] Offline → online: pending outbox rows drain on reconnect (validated in dev, cutover mode)
- [ ] No change to webapp behavior when cutover enabled (projections match direct publish)

## Rollback

Disable `DAEMON_ORCHESTRATION_P1` (and `DAEMON_ORCHESTRATION_P1_CUTOVER` if set); direct publishers remain authoritative.

## Remaining (post-merge)

1. Merge PR stack #1340 → #1343
2. Enable `DAEMON_ORCHESTRATION_P1=1` in dev; run shadow soak ≥1 week
3. Enable `DAEMON_ORCHESTRATION_P1_CUTOVER=1`; validate cutover path and offline drain
4. Optional: parity logging between shadow validation and direct publish before cutover
