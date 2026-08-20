---
type: decision-log
title: Chatroom event stream writer inventory
description: Production locations that currently write chatroom_eventStream records in the Convex backend.
tags: [chatroom, events, convex, daemon-migration]
status: active
---

# Chatroom event stream writer inventory

As of 2026-08-19, production code contains 22 files that write to the Convex `chatroom_eventStream` table. This is the migration baseline for redirecting event capture to the daemon's local repository.

## Production writers

### Convex modules

- `services/backend/convex/agentResumeStorm.ts:38`
- `services/backend/convex/connections.ts:76`
- `services/backend/convex/machines.ts:389, 1235, 1269, 1503, 1567, 1705, 1789, 1909, 1939, 2029, 2751, 2808, 2869, 2906, 2943, 2981, 3018, 3060, 3101, 3141, 3174, 3205, 3232, 3259, 3285, 3311, 3339`
- `services/backend/convex/participants.ts:197, 224`
- `services/backend/convex/tasks.ts:250`
- `services/backend/convex/utils/teamRoleKey.ts:44`
- `services/backend/convex/web/enhancer/internal.ts:36`

### Domain use cases

- `services/backend/src/domain/usecase/agent/agent-exited.ts:64`
- `services/backend/src/domain/usecase/agent/config-removal.ts:39`
- `services/backend/src/domain/usecase/agent/ensure-only-agent-for-role.ts:73`
- `services/backend/src/domain/usecase/agent/request-agent-restart.ts:112`
- `services/backend/src/domain/usecase/agent/start-agent.ts:140, 156`
- `services/backend/src/domain/usecase/agent/stop-agent.ts:75`
- `services/backend/src/domain/usecase/enhancer/planner-enhancing-status.ts:33`
- `services/backend/src/domain/usecase/participant/handle-native-agent-end.ts:19, 59`
- `services/backend/src/domain/usecase/skills/activate-skill.ts:61`
- `services/backend/src/domain/usecase/task/acknowledge-pending-task.ts:30`
- `services/backend/src/domain/usecase/task/create-task.ts:142`
- `services/backend/src/domain/usecase/task/read-task.ts:126`
- `services/backend/src/domain/usecase/task/transition-task.ts:139, 152, 170`
- `services/backend/src/domain/usecase/team/update-team.ts:85`
- `services/backend/src/domain/usecase/workspace/request-sync-on-handoff-to-user.ts:35`

## Non-production references

Test fixtures also insert into the table in `services/backend/convex/getCommandEvents.spec.ts`, `services/backend/tests/integration/event-stream.spec.ts`, and `services/backend/tests/integration/get-latest-agent-event.spec.ts`. Migrations and cleanup code can read or delete records but are not event producers.

## Migration implication

There is no single Convex writer abstraction today. Migration must update these call sites individually or introduce a shared event-writing port. The daemon-side `eventStream.ingest` API captures event-shaped payloads locally in `event_stream_entries` (SQLite). It does not automatically redirect these backend call sites.

**How to migrate:** Follow the per-event guides and conventions in [Chatroom event stream daemon migration](/migrations/chatroom-event-stream-daemon-migration.md#migration-conventions). The `agent.exited` reference commit (`9f7908136`) demonstrates audit migration; state handlers belong in `services/backend/convex/daemon/agentEvents.ts`.
