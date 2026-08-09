# Phase P7 — User Message Intent Feed

**Status:** Implemented (in review) — [PR #1358](https://github.com/conradkoh/chatroom/pull/1358)  
**Depends on:** [P6](./p6-cli-migration.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P7` — when off, daemon does not subscribe to intents.

> **Sub-flag (future):** `DAEMON_ORCHESTRATION_P7_CUTOVER` — disable snapshot WS for
> user-message discovery (P7-T3, post-soak).

## Shippability

**Shippable alone:** Yes — flag-gated; webapp unchanged; Convex still owns message + task writes.

### What ships

- Remote webapp keeps sending messages via Convex (`api.messages.sendMessage`) — **no daemon HTTP call**.
- Convex inserts a lean `chatroom_daemonOrchestrationIntents` row per target machine when a user message creates a task.
- Daemon (with `DAEMON_ORCHESTRATION_P7=1`) pulls intents via a **user-intent** incremental-sync subscriber, ingests into local SQLite read models, and wakes native delivery.

### Flow

```
Webapp ──api.messages.sendMessage──▶ Convex (message + task write)
                                        │  emitDaemonOrchestrationIntentForUserMessage
                                        ▼
                          chatroom_daemonOrchestrationIntents (per machine, lean)
                                        │  subscribeDaemonOrchestrationIntentsSince (WS cursor)
                                        ▼
                          daemon user-intent subscriber (P7 on)
                                        │  handleUserMessageIntentInbound
                                        ▼
                          local read model upsert → tryInjectNextForRole → delivery
```

### Flag-off guarantee

With `DAEMON_ORCHESTRATION_P7` unset the daemon does not register the intent
subscriber and no new code path executes. Intent rows may still be inserted on
Convex (cheap, idempotent) — the daemon simply ignores them. Webapp behavior is
unchanged in both modes.

### Progressive rollout

1. **P7 on:** daemon ingests intents; snapshot WS still present (redundant wake).
2. **P7-T2:** queued-message promotion intents (`promote-queued-message.ts`).
3. **P7-T3:** `DAEMON_ORCHESTRATION_P7_CUTOVER` — disable snapshot WS for user-message discovery.

### Ship checklist

- [ ] Webapp unchanged (grep: no new daemon HTTP calls in `apps/webapp/`)
- [ ] `sendMessage` → intent row for correct machineId
- [ ] Daemon with P7 on ingests intent → read model row → delivery wake
- [ ] Flag off: no intent subscriber registered; existing tests pass

---

## Goal

Replace snapshot WS as the wake mechanism for user messages with a lean,
machine-routed intent feed that the daemon pulls as user-intent inbound.

## Prerequisites

- P2 read models (tasks, participants).
- P5 user-intent subscriber registry.

---

## Todos

### P7-T1 — User-message intent feed `[new]` _(this PR)_

**Implement:**

- `services/backend/convex/schema.ts` — `chatroom_daemonOrchestrationIntents` table + indexes
- `services/backend/src/domain/usecase/machine/daemon-orchestration-intent-types.ts`
- `services/backend/src/domain/usecase/machine/emit-daemon-orchestration-intent.ts`
- `services/backend/src/domain/usecase/machine/subscribe-daemon-orchestration-intents.ts`
- `services/backend/convex/machines.ts` — `subscribeDaemonOrchestrationIntentsSince`
- `services/backend/src/domain/usecase/chatroom/send-automated-user-message.ts` — emit after task creation (direct path)
- Daemon: feed + subscriber + `handle-user-message-intent-inbound` + event-router case + registries

**Verify:**

- `sendMessage` → intent row; subscribe returns it; cursor replay idempotent (integration test)
- Intent → read model row → `tryInjectNextForRole` (unit test)

### P7-T2 — Queued message promotion intents `[future]`

Promote queued messages (`chatroom_messageQueue` / `promote-queued-message.ts`) emit
intents too, so the daemon wakes when a queued message becomes a task.

### P7-T3 — Cutover `[future]`

`DAEMON_ORCHESTRATION_P7_CUTOVER` — disable snapshot WS for user-message discovery
after P7-T1+T2 soak.

---

## Definition of done

- [ ] Webapp → Convex → intent row → daemon subscriber → local read model → delivery (flag on)
- [ ] Flag off = unchanged behavior
- [ ] `pnpm turbo run typecheck test --filter=chatroom-cli --filter=@workspace/backend` green

## Rollback

Disable `DAEMON_ORCHESTRATION_P7`; daemon reverts to snapshot WS wake only.
