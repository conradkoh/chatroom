# Phase P8 — Single Machine, Single Workspace

**Status:** Implemented (in review) — PR pending (stacked on P7)  
**Depends on:** [P7](./p7-user-message-intent.md) (soak complete)  
**Feature flags:** `DAEMON_ORCHESTRATION_P8` · `DAEMON_ORCHESTRATION_P8_CUTOVER` (enforce binding; reject multi-machine configs)

## Shippability

**Shippable alone:** Yes — flag-gated validation + backfill. Multi-machine chatrooms are **not supported** when P8 is enabled (no grandfathering).

### What ships

- Chatroom **orchestration host** model: one `machineId` + one `workingDir` owns all team agent roles
- Validation rejects (or warns then rejects on cutover) `chatroom_teamAgentConfigs` with mismatched `machineId` or `workingDir` within a chatroom
- Daemon asserts chatroom ownership on orchestration HTTP commands
- Cross-machine signal/intent fan-out removed for P8-bound chatrooms
- Migration/backfill for existing chatrooms

### Flag-off guarantee

`DAEMON_ORCHESTRATION_P8` off → no validation changes; multi-machine chatrooms work as today.

### Progressive rollout

1. **P8 on (shadow):** Log violations when team configs have >1 machineId or >1 workingDir per chatroom; no reject.
2. **P8_CUTOVER on:** Reject mismatched configs. Chatrooms with agents on multiple machines/workspaces are **unsupported** — orchestration blocked until reconfigured to a single host.
3. **P8-T5:** Daemon HTTP routes return `403 chatroom_not_hosted` when local `machineId` ≠ chatroom orchestration host.

### Ship checklist

- [x] Flag off: multi-machine chatrooms unchanged
- [x] Flag on + shadow: violation logging without reject
- [x] Flag on + cutover: duo team E2E on single machine (planner → builder handoff, no Convex signal round-trip)
- [x] Backfill sets orchestration host on single-machine chatrooms only; multi-machine chatrooms rejected (no migration path)
- [x] Webapp shows orchestration host binding (read-only indicator minimum)

### Toward outcome

Eliminates cross-machine orchestration complexity — the root cause of open questions in P1–P7. Unblocks P9 full daemon SSOT.

---

## Goal

Bind each chatroom's orchestration to exactly **one machine** and **one workspace directory**. All `chatroom_teamAgentConfigs` with `type: 'remote'` for a chatroom share the same `machineId` and `workingDir`. The hosting daemon becomes the unambiguous orchestration owner.

## Prerequisites

- P7 shipped and soaked (user-message intent path stable).
- P3 + P6 enabled in dev for handoff/claim local paths.

---

## Todos

### P8-T1 — Orchestration host model `[new]`

**Implement:**

- `services/backend/convex/schema.ts` — add optional fields on `chatroom_rooms`:
  ```typescript
  orchestrationMachineId: v.optional(v.string()),
  orchestrationWorkingDir: v.optional(v.string()),
  ```
- `services/backend/src/domain/usecase/chatroom/orchestration-host.ts` — helpers:
  - `resolveOrchestrationHost(chatroom, teamConfigs)` → `{ machineId, workingDir } | null`
  - `assertSingleMachineWorkspace(teamConfigs)` → throws `OrchestrationHostConflict` if >1 distinct machineId or workingDir among remote configs
- `packages/cli/src/daemon/domain/value-objects/orchestration-host.ts` — mirror type for daemon-side checks

**Verify:**

| Check           | Test             | Expected                                                |
| --------------- | ---------------- | ------------------------------------------------------- |
| Resolve host    | unit test        | All remote configs same machine → host resolved         |
| Conflict detect | unit test        | planner on machine A, builder on machine B → conflict   |
| Schema optional | migration safety | Existing chatrooms without fields still work (flag off) |

### P8-T2 — Team config validation `[modify]`

**Modify:**

- `services/backend/src/domain/usecase/machine/patch-team-agent-config.ts` — when P8 on, call `assertSingleMachineWorkspace` before patch; when P8_CUTOVER, reject with user-visible error
- `services/backend/convex/machines.ts` — surface validation error to webapp

**Do NOT modify:** Custom agent configs (`type: 'custom'`) — excluded from host resolution.

**Verify:**

| Check              | Test             | Expected                                                 |
| ------------------ | ---------------- | -------------------------------------------------------- |
| Shadow mode        | integration test | Mismatch logged, patch succeeds                          |
| Cutover mode       | integration test | Mismatch rejected with clear error                       |
| Same-machine patch | integration test | planner + builder same machineId + workingDir → succeeds |

### P8-T3 — Webapp orchestration host UX `[modify]`

**Modify:**

- Webapp team settings: show orchestration host (`machineId` hostname + `workingDir`) when P8 chatroom has host bound
- Prevent UI from assigning different machines to roles in same chatroom when P8_CUTOVER on (disable machine picker mismatch)

**Verify:**

| Check            | Test   | Expected                                                 |
| ---------------- | ------ | -------------------------------------------------------- |
| Host display     | manual | Duo chatroom shows single machine badge                  |
| Mismatch blocked | manual | Cannot save builder on different machine when cutover on |

### P8-T4 — Daemon ownership assertion `[modify]`

**Modify:**

- `packages/cli/src/daemon/infrastructure/inbound/local/routes/` — handoff/tasks/messages route handlers: on `/handoff`, `/tasks/claim-next`, `/messages/*`: verify `chatroom.orchestrationMachineId === localMachineId` when P8 on; else `403`
- `packages/cli/src/daemon/entry/command-router.ts` — dispatch checks orchestration host before routing
- `packages/cli/src/daemon/infrastructure/projection/feature-flags.ts` — `isDaemonOrchestrationP8Enabled()`, `isDaemonOrchestrationP8CutoverEnabled()`

**Verify:**

| Check           | Test             | Expected                           |
| --------------- | ---------------- | ---------------------------------- |
| Hosted chatroom | integration test | Local daemon accepts handoff       |
| Non-hosted      | integration test | Different machine's daemon rejects |
| Flag off        | existing tests   | Unchanged                          |

### P8-T5 — Remove cross-machine fan-out `[shrink]`

**Modify:**

- `services/backend/src/domain/usecase/machine/emit-daemon-orchestration-intent.ts` — when chatroom has `orchestrationMachineId`, emit intent to **host machine only** (not per-role machine fan-out)
- `services/backend/src/domain/usecase/machine/machine-assigned-task-snapshot-sync.ts` — snapshot projection scoped to host machine for P8 chatrooms
- Document: assigned-task-signals across machines no longer needed for P8 chatrooms

**Verify:**

| Check                | Test             | Expected                                                             |
| -------------------- | ---------------- | -------------------------------------------------------------------- |
| Intent single target | integration test | User message → one intent row for host machineId only                |
| Duo E2E              | manual P8+P3+P6  | planner handoff → builder claims without cross-machine Convex signal |

### P8-T6 — Backfill single-machine chatrooms `[new]`

**Resolved decision:** Multi-machine chatrooms are **not supported**. No grandfathering or manual conflict-resolution path.

**Implement:**

- `services/backend/convex/migrations.ts` (or one-off mutation) — for chatrooms where all remote configs share `machineId` + `workingDir`, set `orchestrationMachineId` + `orchestrationWorkingDir`
- Chatrooms with conflicting remote configs: leave host fields unset; `assertSingleMachineWorkspace` rejects further orchestration writes when P8_CUTOVER on; webapp surfaces "reconfigure to single machine" (P8-T3)

**Do NOT implement:** Admin query for manual resolution, grandfathering, or cross-machine migration tooling.

**Verify:**

| Check                   | Test             | Expected                                                                     |
| ----------------------- | ---------------- | ---------------------------------------------------------------------------- |
| Single-machine chatroom | migration test   | Host fields populated                                                        |
| Multi-machine chatroom  | integration test | Host fields unset; P8_CUTOVER blocks orchestration with clear error          |
| Reconfigure path        | manual           | User moves all roles to same machine → host resolves → orchestration resumes |

---

## Definition of done

- [x] P8-T1 through P8-T6 complete per verification tables
- [x] Duo team runs entirely on one machine with one workspace
- [x] Cross-machine orchestration paths documented as **unsupported** for P8 chatrooms
- [x] Multi-machine chatrooms explicitly unsupported (no migration/grandfather path documented or implemented)
- [x] Flag off = unchanged behavior

## Rollback

Disable `DAEMON_ORCHESTRATION_P8` / `P8_CUTOVER`; orchestration host fields ignored; multi-machine configs allowed again.
