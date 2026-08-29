# Migrations

Catalog of migration plans, stacks, and transition records. Prefer this index when deciding whether a memory doc is **current work** or **historical archive**.

**Repo:** [conradkoh/chatroom](https://github.com/conradkoh/chatroom)

## Status legend

| Status      | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `active`    | Ongoing migration or follow-up cleanup; doc frontmatter `status: active` |
| `archived`  | Shipped and retained for context; no open slices in the doc              |
| `completed` | Fully done; doc retained as historical SSOT only                         |

When a migration ships, update its row here (status, PR links, next action) in the same commit that archives the doc.

---

## Active migrations

| Document                                                                      | Status   | Summary                                                                                                                                       | PRs                                                                                                                                                                                       | Next                                                                             |
| ----------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Agent operational status projection](agent-operational-status-projection.md) | `active` | Daemon-authoritative operational facts via lifecycle outbox → materialized Convex projection tables; projection-only readers                  | [#1475](https://github.com/conradkoh/chatroom/pull/1475) (superseded), [#1478](https://github.com/conradkoh/chatroom/pull/1478), [#1481](https://github.com/conradkoh/chatroom/pull/1481) | Phase 4 cleanup: duplicate connectivity joins, direct APM mutations, archive doc |
| [Daemon outbox consolidation](daemon-outbox-consolidation.md)                 | `active` | Explicit outbox policies for workspace file-tree checkpoints (coalescing) and deltas (FIFO)                                                   | — (landed incrementally on master)                                                                                                                                                        | Buffered journal migration; workspace request queue consolidation; metrics       |
| [Participant decoupling stack](participant-decoupling-stack.md)               | `active` | Remove participant presence reads from snapshots, daemon delivery, UI, and operational projection; `chatroom_participants` remains write path | [#1523](https://github.com/conradkoh/chatroom/pull/1523)–[#1539](https://github.com/conradkoh/chatroom/pull/1539) (PR1–7 + parallel stacks on release)                                    | **PR8:** `feat/remove-dead-to-participant-view`; PR9–16 backlog in doc           |

---

## Archived migrations

Shipped stacks retained for decision context and slice ordering. Safe to read for history; do not treat open checkboxes as current work without checking this index.

| Document                                                                                                     | Status      | Summary                                                                                                                 | PRs                                                                                                                                                                                                                                    | Notes                                                          |
| ------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [Enhancer handoff-only stack](enhancer-handoff-only-stack.md)                                                | `archived`  | Enhancer completes via `chatroom handoff`; CLI `enhancer complete` removed; remote delivery via `getTaskDeliveryForJob` | [#1527](https://github.com/conradkoh/chatroom/pull/1527), [#1528](https://github.com/conradkoh/chatroom/pull/1528), [#1529](https://github.com/conradkoh/chatroom/pull/1529), [#1539](https://github.com/conradkoh/chatroom/pull/1539) | Merged `release/v1.101.2` 2026-08-29                           |
| [Task inbox machine-level migration](task-inbox-machine-level-migration.md)                                  | `archived`  | Machine-scoped task-status signal inbox replaces chatroom-scoped task monitor; inbox-only daemon discovery              | [#1471](https://github.com/conradkoh/chatroom/pull/1471)                                                                                                                                                                               | Stages 1–4 complete; chatroom signal index retained for webapp |
| [Agent operational status daemon integration](../development/agent-operational-status-daemon-integration.md) | `completed` | Replaced task-snapshot `setDesiredState` workaround with operational projection SSOT + reactive daemon delivery         | [#1479](https://github.com/conradkoh/chatroom/pull/1479), [#1480](https://github.com/conradkoh/chatroom/pull/1480), [#1481](https://github.com/conradkoh/chatroom/pull/1481)                                                           | Lives under `development/`; companion to projection migration  |

---

## Completed migrations (historical)

Fully done; bodies kept as audit trail and implementation SSOT. Start here only when debugging legacy behavior or tracing removed tables.

| Document                                                                            | Status      | Summary                                                                                 | PRs                                                                                                                | Notes                             |
| ----------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| [Chatroom event stream daemon migration](chatroom-event-stream-daemon-migration.md) | `completed` | Moved daemon-originated audit events from Convex `chatroom_eventStream` to local SQLite | [#1465](https://github.com/conradkoh/chatroom/pull/1465), [#1499](https://github.com/conradkoh/chatroom/pull/1499) | Convex table removed 2026-08      |
| [Chatroom event stream writer inventory](chatroom-event-stream-writers.md)          | `completed` | Baseline inventory of 22 Convex event-stream write sites before migration               | [#1499](https://github.com/conradkoh/chatroom/pull/1499)                                                           | Companion to daemon migration doc |

---

## Release reviews

Cross-cutting summaries that span multiple migration stacks:

| Document                                    | Release                                                                                    | PRs                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| [Release v1.101.2](../releases/v1.101.2.md) | Participant decoupling, enhancer handoff-only, native delivery, agent stop, Codex teardown | [Release PR #1521](https://github.com/conradkoh/chatroom/pull/1521) |

---

## Quick reference — PR ranges by theme

| Theme                                  | PR range            | Primary doc                                                                            |
| -------------------------------------- | ------------------- | -------------------------------------------------------------------------------------- |
| Event stream → daemon SQLite           | #1465, #1499        | [chatroom-event-stream-daemon-migration.md](chatroom-event-stream-daemon-migration.md) |
| Task inbox (machine-scoped)            | #1471               | [task-inbox-machine-level-migration.md](task-inbox-machine-level-migration.md)         |
| Operational status projection          | #1475, #1478, #1481 | [agent-operational-status-projection.md](agent-operational-status-projection.md)       |
| Participant decoupling + release stack | #1523–#1539         | [participant-decoupling-stack.md](participant-decoupling-stack.md)                     |
| Enhancer handoff-only                  | #1527–#1529, #1539  | [enhancer-handoff-only-stack.md](enhancer-handoff-only-stack.md)                       |
