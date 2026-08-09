# Phase P7 — User Message Intent Feed

**Status:** P7-T1 implemented (in review) — [PR #1358](https://github.com/conradkoh/chatroom/pull/1358)  
**Depends on:** [P6](./p6-cli-migration.md)  
**Feature flags:** `DAEMON_ORCHESTRATION_P7` (intent subscriber + ingest) · `DAEMON_ORCHESTRATION_P7_CUTOVER` (intent-only user-message wake, post-soak)

## Shippability

**Shippable alone:** Yes — flag-gated; webapp unchanged; Convex still owns message + task writes.

### What ships (P7-T1)

- Remote webapp keeps sending messages via Convex (`api.messages.sendMessage`) — **no daemon HTTP call**.
- Convex inserts a lean `chatroom_daemonOrchestrationIntents` row per target machine when a user message creates a task (direct path).
- Daemon (with `DAEMON_ORCHESTRATION_P7=1`) pulls intents via a **user-intent** incremental-sync subscriber, ingests into local SQLite read models, and wakes native delivery.

### Flag-off guarantee

With `DAEMON_ORCHESTRATION_P7` unset the daemon does not register the intent subscriber. Intent rows may still be inserted on Convex (cheap, idempotent) — the daemon ignores them. Webapp behavior is unchanged.

### Progressive rollout

1. **P7 on:** daemon ingests intents; snapshot WS still present (redundant wake for user messages).
2. **P7-T2:** queued-message promotion emits intents (`promote-queued-message.ts`).
3. **P7-T3:** `DAEMON_ORCHESTRATION_P7_CUTOVER` — intent feed is authoritative for user-message wake (no dependency on snapshot WS push for discovery).
4. **P7-T4:** post-soak cleanup — remove redundant dual-wake assumptions; tighten types; optional Convex projection skip for intent-covered paths.

### Ship checklist

- [x] Webapp unchanged (grep: no new daemon HTTP calls in `apps/webapp/`)
- [x] `sendMessage` direct path → intent row for correct machineId
- [x] Daemon with P7 on ingests intent → read model row → delivery wake
- [x] Flag off: no intent subscriber registered; existing tests pass
- [ ] P7-T2: promote queue → intent row → daemon ingest
- [ ] P7-T3: P7+P7_CUTOVER — delivery without snapshot WS push for user message
- [ ] P7-T4: soak complete; cleanup checklist passed

---

## Goal

Replace snapshot WS as the wake mechanism for user messages with a lean, machine-routed intent feed that the daemon pulls as user-intent inbound.

## Prerequisites

- P2 read models (tasks, participants) — handler calls `upsertTaskReadModel`.
- P5 user-intent subscriber registry — `USER_INTENT_SUBSCRIBERS`.
- P6 not strictly required for intent path but phase stacks on P6 branch.

---

## PR stack

| PR                                                       | Branch                                             | Todos                 |
| -------------------------------------------------------- | -------------------------------------------------- | --------------------- |
| [#1358](https://github.com/conradkoh/chatroom/pull/1358) | `feat/daemon-orchestration-p7-user-message-intent` | P7-T1 + P7-T1w wiring |

Future PRs: T2/T3/T4 as separate stacked PRs or follow-up commits on same branch per team preference.

---

## Todos

### P7-T1 — User-message intent feed `[done]` — PR #1358

**Shipped (backend):**

- `services/backend/convex/schema.ts` — `chatroom_daemonOrchestrationIntents` + `by_machineId_revisionKey` / `by_machineId_taskId`
- `services/backend/src/domain/usecase/machine/daemon-orchestration-intent-types.ts`
- `services/backend/src/domain/usecase/machine/emit-daemon-orchestration-intent.ts` — idempotent per `(machineId, taskId)`; filters `type==='remote'`
- `services/backend/src/domain/usecase/machine/subscribe-daemon-orchestration-intents.ts`
- `services/backend/convex/machines.ts` — `subscribeDaemonOrchestrationIntentsSince`
- `services/backend/src/domain/usecase/chatroom/send-automated-user-message.ts` — emit after task creation (**direct path only**; queue path returns early)

**Shipped (daemon):**

- `packages/cli/src/daemon/infrastructure/projection/feature-flags.ts` — `isDaemonOrchestrationP7Enabled()`
- `packages/cli/src/infrastructure/incremental-sync/feeds/daemon-orchestration-intents.ts`
- `packages/cli/src/daemon/infrastructure/convex/subscribers/daemon-orchestration-intents.ts`
- `packages/cli/src/daemon/domain/entities/inbound-event.ts` — `user-message.intent`
- `packages/cli/src/daemon/domain/usecase/handle-user-message-intent-inbound.ts`
- `packages/cli/src/daemon/entry/event-router.ts` — `user-message.intent` case (not gated by P5 `orchestrationDisabled`)

**Verify (outcomes — all passed on PR #1358):**

| Check                   | Command / test                                                                      | Expected outcome                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Intent row on send      | `services/backend/tests/integration/subscribe-daemon-orchestration-intents.spec.ts` | `sendMessage` → row in `chatroom_daemonOrchestrationIntents`; subscribe returns `machineId` + `revisionKey` |
| Cursor idempotency      | same spec, second test                                                              | Replay cursor does not duplicate rows                                                                       |
| Handler ingest          | `packages/cli/src/daemon/domain/usecase/handle-user-message-intent-inbound.test.ts` | Read model row upserted; `tryInjectNextForRole` called                                                      |
| No-db no-op             | same test file                                                                      | Handler returns without throw when `db` absent                                                              |
| Subscriber registration | `packages/cli/src/daemon/entry/subscriber-registry.duplicate-guard.test.ts`         | `USER_INTENT_SUBSCRIBERS` count 12→13; contains `daemon-orchestration-intents`                              |
| Flag off                | grep `isDaemonOrchestrationP7Enabled` in subscriber registries                      | Subscriber only registered when flag on                                                                     |
| Suite green             | `pnpm turbo run typecheck test --filter=chatroom-cli --filter=@workspace/backend`   | 0 failures                                                                                                  |
| Webapp untouched        | `git diff feat/daemon-orchestration-p6-cli-migration...HEAD -- apps/webapp/`        | empty diff                                                                                                  |

---

### P7-T1w — Daemon startup wiring `[done]` — PR #1358

**Shipped:**

- `packages/cli/src/daemon/entry/start-daemon.ts` — passes `persistence.db` + `machineId` into `createDefaultEventRouterDeps`; `startAllSubscribers` receives wired router
- `packages/cli/src/daemon/entry/default-router-deps.ts` — `userMessageIntent: { db, machineId }` on `EventRouterDeps`
- `packages/cli/src/daemon/infrastructure/inbound/convex/user-intent-subscribers.ts` — `daemon-orchestration-intents` in `USER_INTENT_SUBSCRIBERS`
- `packages/cli/src/daemon/infrastructure/inbound/convex/subscriber-registry.ts` — P7 subscriber behind `isDaemonOrchestrationP7Enabled()`
- `packages/cli/src/daemon/entry/subscriber-registry.ts` — same guard on legacy path; P5 `startAllSubscribers` delegates to inbound registry when P5 on (no double registration)

**Not modified (by design):**

- `deps.ts` — handler deps wired via `createDefaultEventRouterDeps` opts (same pattern as P1 drain worker wired directly in `start-daemon.ts`)

**Verify (outcomes — all passed):**

| Check                       | Command / test                                               | Expected outcome                                       |
| --------------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| Handler receives db         | `handle-user-message-intent-inbound.test.ts` with `db` wired | `upsertTaskReadModel` writes SQLite row                |
| Subscriber starts with flag | `subscriber-registry.duplicate-guard.test.ts`                | P7 subscriber in registry when flag mocked on          |
| No double sub               | code review: P5 on → `startInboundSubscribers` only          | Legacy `ORCHESTRATION_SUBSCRIBERS` path not duplicated |
| Startup log                 | manual: `DAEMON_ORCHESTRATION_P7=1 chatroom daemon start`    | No throw; subscribers start; intent feed polls         |

---

### P7-T2 — Queued message promotion intents `[future]`

**Problem:** When `shouldEnqueueMessage` is true, `sendAutomatedUserMessage` inserts into `chatroom_messageQueue` and returns — **no intent row**. Promotion later via `promoteQueuedMessage` creates task+message but also emits no intent. Daemon only wakes on snapshot WS (or P2 read-model refresh).

**Implement:**

- Extend `intentType` in schema from `v.literal('user_message')` to `v.union(v.literal('user_message'), v.literal('queued_promotion'))`
- Extend `DaemonOrchestrationIntentSignal.intentType` and `emitDaemonOrchestrationIntentForUserMessage` to accept `intentType` param (default `'user_message'`)
- Shared emit helper or call at end of `promote-queued-message.ts` after task+message created:

```typescript
await emitDaemonOrchestrationIntentForUserMessage(ctx, {
  chatroomId: queueRecord.chatroomId,
  taskId,
  messageId,
  assignedRole: getTeamEntryPoint(chatroom) ?? 'planner',
  createdAt: Date.now(),
  intentType: 'queued_promotion',
});
```

**Modify:**

- `services/backend/convex/schema.ts` — intentType union
- `services/backend/src/domain/usecase/machine/daemon-orchestration-intent-types.ts`
- `services/backend/src/domain/usecase/machine/emit-daemon-orchestration-intent.ts` — `intentType` param + store field
- `services/backend/src/domain/usecase/task/promote-queued-message.ts` — emit after promotion
- `packages/cli/src/daemon/domain/entities/inbound-event.ts` — include `intentType` on wire event (optional field; handler treats same as `user_message`)
- `packages/cli/src/daemon/infrastructure/convex/subscribers/daemon-orchestration-intents.ts` — pass `intentType` through

**Do NOT modify:**

- `send-automated-user-message.ts` queue branch — stays enqueue-only; intent fires at promotion time
- `handle-user-message-intent-inbound.ts` — same ingest path for both intent types unless observability needs branching

**Verify:**

| Check                    | Command / test                                                                                               | Expected outcome                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Promotion → intent       | New integration test: enqueue message → `promoteNextTask` → intent row with `intentType: 'queued_promotion'` | Row exists for target `machineId`                         |
| Idempotency              | Replay promote on same taskId                                                                                | `by_machineId_taskId` skip — no duplicate                 |
| Daemon ingest            | Extend `handle-user-message-intent-inbound.test.ts` with `queued_promotion` event                            | Same read-model upsert + `tryInjectNextForRole`           |
| Auto-promote on complete | `services/backend/tests/integration/task-fsm.spec.ts` or new test                                            | Task complete → `maybePromoteNextQueuedTask` → intent row |
| Manual promote           | `promoteSpecificTask` mutation test                                                                          | User promotes from WorkQueue → intent row                 |
| Suite green              | `pnpm turbo run typecheck test --filter=chatroom-cli --filter=@workspace/backend`                            | 0 failures                                                |

---

### P7-T3 — Cutover: intent-only user-message wake `[future]`

**Prerequisite:** P7-T1 + P7-T2 shipped; shadow soak with `DAEMON_ORCHESTRATION_P7=1` (P7_CUTOVER off) ≥1 week.

**Goal:** User-message tasks are discovered via intent feed only. Daemon does not depend on `listMachineAssignedTaskSnapshots` WS push arriving before delivery for user-message-created tasks.

**Implement:**

- `packages/cli/src/daemon/infrastructure/projection/feature-flags.ts`:

```typescript
/** DAEMON_ORCHESTRATION_P7_CUTOVER — intent feed authoritative for user-message wake; no snapshot WS dependency for discovery */
export function isDaemonOrchestrationP7CutoverEnabled(): boolean {
  return envTruthy(process.env.DAEMON_ORCHESTRATION_P7_CUTOVER);
}
```

- `handle-user-message-intent-inbound.ts` — when P7 cutover on, intent-ingested snapshot row is authoritative (already upserts read model + snapshot store; document invariant)
- `task-monitor-runtime.ts` — when `isDaemonOrchestrationP7Enabled() && isDaemonOrchestrationP7CutoverEnabled()`, periodic reconcile / monitor pass for **user-message-origin pending tasks** prefers intent-populated read model (do not wait for WS `replaceAssignedTaskSnapshots` to discover the task). Implementation options (pick one in PR, document choice):
  - **Option A (minimal):** No task-monitor change — intent handler already calls `tryInjectNextForRole` synchronously; cutover flag only gates logging/metrics + documents that WS is redundant for user messages.
  - **Option B (explicit):** Skip merging WS snapshot rows that would overwrite a fresher intent-ingested row for same `(taskId, chatroomId)` when cutover on.

**Relationship to P2 cutover:**

| Flags                        | Snapshot WS                          | User-message wake     |
| ---------------------------- | ------------------------------------ | --------------------- |
| P7 only                      | Still subscribed (unless P2 cutover) | Intent + redundant WS |
| P7 + P7_CUTOVER              | May still run for signals/nudges     | Intent authoritative  |
| P2_CUTOVER + P7              | WS skipped entirely                  | Intent authoritative  |
| P7 + P7_CUTOVER + P2_CUTOVER | Full local                           | Intent authoritative  |

**Verify:**

| Check                    | Command / test                                     | Expected outcome                                       |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------ |
| Flag helper              | unit test in `feature-flags` or existing test file | `P7_CUTOVER` reads env correctly                       |
| Delivery without WS push | New integration test: mock WS silent after intent  | `tryInjectNextForRole` still fires from intent handler |
| Flag off unchanged       | existing P7 tests with cutover unset               | Identical behavior to T1                               |
| Manual E2E               | P7+P7_CUTOVER on; send webapp message              | Task delivered without waiting for snapshot WS latency |
| Rollback                 | unset `DAEMON_ORCHESTRATION_P7_CUTOVER`            | WS redundant wake resumes; no data loss                |

---

### P7-T4 — Post-soak cleanup `[future]`

**Prerequisite:** `DAEMON_ORCHESTRATION_P7=1` + T2 + T3 enabled in dev ≥2 weeks; no user-message delivery regressions.

**Shrink (evaluate each — document keep/delete decision in PR):**

| Target                                                                       | Action                                                      | Rationale                                                                           |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `parsePage`/`parseItem` `as` casts in `daemon-orchestration-intents.ts` feed | Tighten with zod/runtime parse OR keep with `fallow-ignore` | Match assigned-task-signals pattern unless team wants stricter validation           |
| Redundant dual-wake documentation in task-monitor                            | Update comments only                                        | Clarify intent vs WS roles post-cutover                                             |
| `projectAssignedTaskSnapshotsForChatroom` in `create-task.ts`                | **Keep** until P2 cutover                                   | Shared path; snapshot still needed for non-intent consumers and task-monitor nudges |
| `restartOfflineAgentsOnUserMessage` snapshot refresh                         | **Keep**                                                    | Offline agent restart still needs snapshot refresh for non-P7 paths                 |
| Intent rows `status: 'claimed'` transition                                   | Implement claim ack OR delete stale rows                    | Currently rows stay `pending` — evaluate TTL/cleanup job (optional)                 |

**Delete (only when ALL true):**

- P7 + P7_CUTOVER + P2_CUTOVER on in production soak
- Grep confirms no code path depends on snapshot WS for user-message discovery

**Verify:**

| Check               | Command / test                                                                         | Expected outcome                                                                          |
| ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| No regression       | full `pnpm turbo run typecheck test --filter=chatroom-cli --filter=@workspace/backend` | 0 failures                                                                                |
| Lifecycle matrix    | `docs/plans/task-lifecycle-refactor-test-matrix.md` scenarios 1–7                      | Manual or automated pass                                                                  |
| Grep audit          | `rg "listMachineAssignedTaskSnapshots" packages/cli/src/daemon`                        | Document each remaining callsite — none should be user-message-only hot path post-cutover |
| Intent table growth | optional: monitor `chatroom_daemonOrchestrationIntents` row count                      | No unbounded growth if TTL added                                                          |

---

## Definition of done

- [x] P7-T1: Webapp → Convex → intent row → daemon subscriber → local read model → delivery (flag on)
- [x] P7-T1w: Daemon wiring complete (db + machineId + subscriber registry)
- [ ] P7-T2: Queued promotion → intent row → daemon ingest
- [ ] P7-T3: P7_CUTOVER — intent-only user-message wake verified
- [ ] P7-T4: Post-soak cleanup complete
- [x] Flag off = unchanged behavior (T1)
- [x] `pnpm turbo run typecheck test --filter=chatroom-cli --filter=@workspace/backend` green (T1)

## Rollback

Disable `DAEMON_ORCHESTRATION_P7` (and `DAEMON_ORCHESTRATION_P7_CUTOVER` if set); daemon reverts to snapshot WS wake only. Convex intent rows are inert when daemon ignores them.

## Remaining (post-merge)

1. Merge PR #1358 (after P6)
2. Enable `DAEMON_ORCHESTRATION_P7=1` in dev; shadow soak ≥1 week (intent + redundant WS)
3. Ship P7-T2 (queued promotion intents)
4. Enable `DAEMON_ORCHESTRATION_P7_CUTOVER=1`; validate intent-only wake
5. After ≥2 weeks soak → P7-T4 cleanup PR
