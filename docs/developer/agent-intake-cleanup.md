# Agent intake cleanup — classify, task read, report-progress

**Status:** Implemented in `dcc006185` (classify + token-driven progress).  
**Related:** [workflow-removal-inventory.md](./workflow-removal-inventory.md) (DAG `chatroom workflow` — separate track, largely done in `d92b54e79`).

---

## Goal

Remove mandatory **classify**, **task read**, and **report-progress** steps from the agent intake path. Agents should start work from inline task content; harness stdout marks tasks `in_progress`.

---

## What changed

| Area                    | Before                                                                                    | After                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **CLI intake**          | `get-next-task` hid task body; agent ran `task read` to load content + mark `in_progress` | Full task body inline in `get-next-task` output                           |
| **Native intake**       | Already inline via injection                                                              | Unchanged; added token-activity note in prompts                           |
| **Activity signal**     | `task read` / `classify` mutations                                                        | `participants.updateTokenActivity` on first harness stdout (CLI + native) |
| **CLI `task read`**     | Required first step                                                                       | Optional recovery (backlog attachments not in delivery)                   |
| **`chatroom classify`** | Entry-point mandatory step                                                                | **Removed** (CLI command + `messages.taskStarted` mutation)               |
| **`report-progress`**   | Periodic status CLI                                                                       | **Removed** (prior commit `21e7c0385`)                                    |

### Backend

- `updateTokenActivity` starts acknowledged tasks when `lastSeenAction` is `native:task-injected` **or** `get-next-task:stopped` (CLI delivery race).
- `GET_NEXT_TASK_STOPPED_ACTION` constant in `participant.ts`.

### Prompts

- `token-activity-note.ts` — shared CLI vs native wording.
- `fullOutput.ts` — inline `task.content`, next steps start with “Work on the task above.”
- Operating-model diagrams — no `task read` node; “Receive chatroom task from get-next-task”.
- `classification-guide.ts` — renamed role: task intake guide (not message classification).

### CLI

- Deleted `packages/cli/src/commands/classify/`.
- `task read` description → optional recovery.

### Docs (this pass)

- [HARNESS_GUIDE.md](../../packages/cli/src/infrastructure/services/remote-agents/HARNESS_GUIDE.md) — unified status lifecycle table + `updateTokenActivity` section.

---

## Still optional / follow-up

| Item                   | Notes                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `prompts/readme.md`    | Still mentions `classify` command — update when touching prompt docs               |
| `generator.ts` comment | Says “classify guidance” — cosmetic                                                |
| `task/readCommand.ts`  | Kept for optional recovery command examples                                        |
| Schema comments        | `startedAt` / classification fields on messages — historical data, not intake path |

---

## Verification

Connectivity test (2026-06-24 19:05): planner (`cursor-sdk`) → builder (`opencode-sdk`) → planner → user with inline injection, no `task read`, `native:waiting` after each turn. See [cursor-sdk-reliability-incident-report.md](./cursor-sdk-reliability-incident-report.md).

```bash
pnpm --filter backend test
pnpm --filter @workspace/cli test
```
