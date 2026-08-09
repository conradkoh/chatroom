# Phase P6 — CLI Migration

**Status:** Implemented (in review) — [PR #1357](https://github.com/conradkoh/chatroom/pull/1357)  
**Depends on:** [P3](./p3-handoff-local.md)  
**Feature flag:** `DAEMON_ORCHESTRATION_P6` — per-command sub-flags optional.

> **Commands that stay Convex (documented):**
>
> - `backlog listHistorical` — cross-machine read; stays on Convex.
> - `context new` / `context list` / `context inspect` — context write/list ops; stays on Convex.
> - `messages download`/`anchor` read paths route via daemon (`DAEMON_ORCHESTRATION_P6_MESSAGES`); `get-next-task` delivery prompt (`getTaskDeliveryPrompt`) stays on Convex during transition.

## Shippability

**Shippable alone:** Yes — per-command sub-flags; P4/P5 not required (only P3 for HTTP server + P2 for read models).

### What ships

- `get-next-task`, `messages *`, `context *`, `task read` via daemon HTTP (per sub-flag)
- Agents read/claim from daemon SSOT when enabled

### Flag-off guarantee

All CLI commands continue Convex-first paths — identical to today.

### Progressive rollout

1. Ship each command behind its own sub-flag (e.g. `DAEMON_ORCHESTRATION_P6_GET_NEXT_TASK`, `..._MESSAGES`, etc.) or enable P6 incrementally per todo.
2. **Legacy deletion (`DAEMON_ORCHESTRATION_P6_LEGACY_DELETE`):** Only after all P6 sub-flags on and soaked ≥2 weeks. Removes Convex fallbacks — separate PR from initial P6 commands.

### Toward outcome

Agents use daemon as SSOT; completes CLI migration per discovery §4.3.

### Ship checklist

- [ ] Each command sub-flag: parity test vs Convex path before enabling
- [ ] Flag off: all commands unchanged
- [ ] Receipt lifecycle preserved (`docs/plans/task-lifecycle-refactor-test-matrix.md` scenarios 1–7)
- [ ] LEGACY_DELETE: only after soak; grep confirms zero `api.messages.handoff` / `api.tasks.claimTask` in commands when all flags on

---

## Goal

Route remaining agent harness commands through daemon HTTP: `get-next-task`, `task read`, `messages *`, `context *`. Agents use daemon as SSOT for reads and claims.

## Prerequisites

- P3 handoff local (daemon HTTP server exists).
- P2 read models populated.

---

## Todos

### P6-T1 — get-next-task via daemon HTTP `[modify]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/inbound/local/routes/tasks.route.ts` — POST `/tasks/claim-next`
- `packages/cli/src/daemon/application/use-cases/tasks/claim-next-task.ts` — local claim against read models + event append
- `packages/cli/src/daemon/application/use-cases/tasks/deliver-task.ts` — `[migrate]` from `entry/native-delivery/`

**Modify:**

- `packages/cli/src/commands/get-next-task/` (or equivalent path — grep `get-next-task`) — call daemon HTTP when P6 on
- `packages/cli/src/daemon/entry/command-router.ts` — wire tasks routes

**Delete:** Direct Convex `tasks.claimTask` / `messages.claimMessage` on hot path when P6 on.

**Verify:**

- `pnpm --filter chatroom-cli test get-next-task` passes
- Non-native harness receives task via daemon HTTP
- Receipt lifecycle (`cli_get_next_task`) preserved per `docs/plans/task-lifecycle-refactor-test-matrix.md`

### P6-T2 — Read commands via daemon HTTP `[modify]`

**Implement:**

- `packages/cli/src/daemon/infrastructure/inbound/local/routes/messages.route.ts` — GET endpoints for listSince, getLastUser, getContext
- `packages/cli/src/daemon/application/use-cases/` — thin read delegates to read models + SQLite message cache (or project from Convex on miss during transition)

**Modify:**

- `packages/cli/src/commands/messages/` — daemon HTTP client when P6 on
- `packages/cli/src/commands/context/` — daemon HTTP client when P6 on

**Verify:**

- Agent harness context/messages commands return same data as Convex queries (parity test)

### P6-T3 — task read / backlog reads `[modify]`

**Modify:**

- `packages/cli/src/commands/task/` — `readTask` via daemon
- `packages/cli/src/commands/backlog/` — evaluate per-command; listHistorical may stay Convex (cross-machine) — document decision in phase doc if stays

**Verify:**

- `chatroom task read` acknowledges task locally and projects status

### P6-T4 — Backend idempotent projection handlers `[modify]`

**Modify:**

- `services/backend/convex/tasks.ts` — `projectTaskClaimFromDaemon`, `projectTaskStatusFromDaemon`
- `services/backend/convex/messages.ts` — read projections if needed

**Verify:**

- `pnpm --filter @workspace/backend test tasks messages` passes
- Multi-machine: Convex remains authority for cross-machine conflicts (document in test)

### P6-T5 — Remove legacy Convex-first paths (post-soak only) `[delete]`

**Prerequisite:** `DAEMON_ORCHESTRATION_P6_LEGACY_DELETE` enabled only after all P6 command sub-flags on and soaked ≥2 weeks.

**Delete (when LEGACY_DELETE on):**

- Convex direct-call fallbacks in `commands/handoff/`, `commands/get-next-task/`
- `infrastructure/convex/publishers/` — entire folder if all types migrated to projection handlers
- `entry/subscriber-registry.ts` — if fully replaced by inbound registry

**Verify:**

- Grep `api.messages.handoff`, `api.tasks.claimTask` in `packages/cli/src/commands/` — zero hits
- `pnpm turbo run typecheck test --filter=chatroom-cli --filter=@workspace/backend` green
- Manual QA matrix from `docs/plans/task-lifecycle-refactor-test-matrix.md` scenarios 1–7 pass

**Note:** P6 is shippable without T5. T5 is a separate cleanup slice after soak.

---

## Definition of done

- [ ] `handoff` and `get-next-task` use daemon HTTP with all orchestration flags on
- [ ] Agent read commands served from daemon
- [ ] No CLI → Convex orchestration mutations on hot path
- [ ] Success criteria from discovery §9 all checked

## Rollback

Per-command flags revert individual commands to Convex.
