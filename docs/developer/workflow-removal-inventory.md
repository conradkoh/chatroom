# Workflow feature — removal inventory

**Status:** Largely complete as of `d92b54e79` (DAG `chatroom workflow`, skill, Convex APIs, webapp visualizer).  
**Related:** [agent-intake-cleanup.md](./agent-intake-cleanup.md) — classify / task read / report-progress removal (`dcc006185`).

Goal: **remove the DAG structured-workflow feature** (`chatroom workflow`, `workflow` skill, `chatroom_workflows` tables, UI visualizer) and scrub prompts that teach it.

**Out of scope for this inventory (do not delete):**

- `.github/workflows/` — GitHub Actions CI/CD
- `native-workflow-*.ts` test helpers — “workflow” = native task disclosure, not DAG
- `prompts/cli/sections/workflow.ts` — **role operating model** (mermaid); rename when removing DAG terminology, do not delete the diagram itself without replacement
- `development-workflow` skill — git/release process skill (separate product concept; decide keep/rename separately)

---

## 0. Completed (check before re-doing work)

| Item                                                  | Status                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/cli/src/commands/workflow/`                 | Removed                                                            |
| `prompts/cli/workflows/`                              | Removed                                                            |
| `prompts/cli/roles/builder.ts` “workflow step” block  | Removed                                                            |
| `## Planner Workflow` / `## Builder Workflow` headers | Renamed → **Operating model** (`operating-model.ts`, team prompts) |
| `generator.ts` workflow skill reminder in classify    | Removed with classify (`dcc006185`)                                |
| `services/backend/convex/workflows.ts`                | Removed                                                            |
| Webapp `WorkflowVisualizer`, chips, events            | Removed                                                            |
| `workflow` skill module                               | Removed from registry                                              |

**Still uses the word “workflow” (intentional):**

- `development-workflow` skill — git/release process (not DAG)
- Mermaid “Workflow Loop” in getting-started — session listen loop, not DAG
- `.github/workflows/` — CI

---

## 1. Prompts & agent-facing text (DAG / skill) — historical inventory

Most rows below are **done**. Re-grep before acting:

```bash
rg -i 'workflow skill|chatroom workflow|step-view|step-complete' services/backend/prompts packages/cli
```

| File                                                                    | What to remove / change                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `services/backend/prompts/sections/glossary.ts`                         | `workflow` and possibly `development-workflow` glossary entries              |
| `services/backend/prompts/cli/sections/delegation-guidelines.ts`        | “Optional: structured workflows (opt-in)” + `skill activate workflow`        |
| `services/backend/prompts/cli/sections/delegation-and-decomposition.ts` | workflow skill activation block                                              |
| `services/backend/prompts/cli/roles/builder.ts`                         | **When working on a workflow step:** block (`step-view`, `step-complete`)    |
| `services/backend/prompts/cli/handoff-templates/index.ts`               | Comment referencing structured workflows / workflow skill                    |
| `services/backend/prompts/generator.ts`                                 | `💡 Use the workflow skill for multi-step tasks` in classification reminders |
| `services/backend/prompts/cli/get-next-task/fullOutput.ts`              | “structured workflow is optional” delegate step wording                      |
| `services/backend/prompts/cli/get-next-task/available-actions.ts`       | “For backlog commands and workflows, activate…”                              |
| `services/backend/prompts/cli/workflows/index.ts`                       | Legacy workflow prompt definitions                                           |
| `services/backend/prompts/cli/workflows/pair.ts`                        | Pair-team workflow prompts (dead team?)                                      |

### Prompt tests with embedded workflow text (update snapshots)

- `services/backend/tests/integration/cli/agent-system-prompt.spec.ts`
- `services/backend/tests/integration/teams/duo/planner/system-prompt.spec.ts`
- `services/backend/tests/integration/teams/duo/builder/system-prompt.spec.ts`
- `services/backend/tests/integration/cli/get-next-task-prompt.spec.ts`
- `services/backend/tests/unit/role-guidance-hardcoded-roles.spec.ts`
- `services/backend/tests/unit/prompts/generator-solo.test.ts`

---

## 2. Skills system

| File                                                                   | Action                                 |
| ---------------------------------------------------------------------- | -------------------------------------- |
| `services/backend/src/domain/usecase/skills/modules/workflow/index.ts` | Delete module                          |
| `services/backend/src/domain/usecase/skills/registry.ts`               | Remove `workflowSkill` import/register |
| `services/backend/tests/integration/skills/workflow-skill.spec.ts`     | Delete                                 |
| `packages/cli/src/commands/skill/skill.test.ts`                        | Remove workflow skill fixture          |

**Related (decide separately):** `development-workflow` skill — git branch/PR process, not DAG.

---

## 3. Backend / Convex

| File                                                                               | Action                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `services/backend/convex/workflows.ts`                                             | Delete API surface                                                                                                                                                 |
| `services/backend/convex/lib/taskWorkflows.ts`                                     | Delete                                                                                                                                                             |
| `services/backend/convex/schema.ts`                                                | **Deprecated** (not removed): `chatroom_workflows`, workflow steps tables, `attachedWorkflowIds`, `workflow.*` event variants — kept for deploy/data compatibility |
| `services/backend/convex/messages.ts`                                              | Remove `attachedWorkflowIds` handling on handoff                                                                                                                   |
| `services/backend/convex/chatroomSkillCustomizations.ts`                           | Remove `development_workflow` type if dropping that skill too                                                                                                      |
| `services/backend/tests/integration/workflows.spec.ts`                             | Delete                                                                                                                                                             |
| `services/backend/tests/integration/task-workflow.spec.ts`                         | Delete                                                                                                                                                             |
| `services/backend/tests/integration/teams/duo/planner/handoff-no-workflow.spec.ts` | Keep intent, rename (handoff without DAG) or fold into general handoff test                                                                                        |

Event stream types referencing workflows in `services/backend/src/domain/entities/events.ts` and schema event unions.

---

## 4. CLI

| File                                                  | Action                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/cli/src/commands/workflow/`                 | Delete entire command group                                              |
| `packages/cli/src/index.ts`                           | Remove `workflow` subcommand; remove `workflow-key:` handoff attachments |
| `packages/cli/src/commands/handoff/index.ts`          | Remove workflow attachment resolution + display                          |
| `packages/cli/src/commands/workflow/workflow.test.ts` | Delete                                                                   |

---

## 5. Webapp

| File                                                                     | Action                       |
| ------------------------------------------------------------------------ | ---------------------------- |
| `apps/webapp/src/modules/chatroom/components/WorkflowVisualizer.tsx`     | Delete                       |
| `apps/webapp/src/modules/chatroom/components/AttachedWorkflowChip.tsx`   | Delete                       |
| `apps/webapp/src/modules/chatroom/utils/workflowMermaid.ts`              | Delete                       |
| `apps/webapp/src/modules/chatroom/eventTypes/workflowEvents.tsx`         | Delete                       |
| `apps/webapp/src/modules/chatroom/eventTypes/index.ts`                   | Unregister workflow events   |
| `apps/webapp/src/domain/entities/event-type.ts`                          | Remove workflow event labels |
| `apps/webapp/src/domain/entities/event-stream-event.ts`                  | Remove workflow event types  |
| `apps/webapp/src/modules/chatroom/types/message.ts`                      | Remove `attachedWorkflows`   |
| `apps/webapp/src/modules/chatroom/components/MessageAttachmentChips.tsx` | Remove workflow chips        |
| Work queue modals / timeline                                             | Remove workflow references   |

---

## 6. Naming collisions (rename, not delete)

To stop agents saying “the workflow requires handoff to user”:

| Current                                          | Suggested rename                                                |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `## Planner Workflow`                            | `## Planner operating model` or `## Planner loop`               |
| `## Builder Workflow`                            | `## Builder operating model`                                    |
| `**Workflow: Planner + Builder**`                | `**Operating model: Planner + Builder**`                        |
| `SelectorContext.workflow` (`types/sections.ts`) | `classification` (already means question/new_feature/follow_up) |
| `teams/*/config.ts` `workflow: 'duo'`            | Rename key if it means team template id (check consumers)       |

---

## 7. Suggested removal order

1. **Prompts + glossary + builder workflow-step block** — stops teaching agents immediately (no runtime dependency).
2. **CLI `workflow` commands + handoff workflow-key attachments** — prevents new DAG creation.
3. **Skills registry** — remove `workflow` skill module.
4. **Convex APIs + schema** — migration to drop tables / columns (needs data migration plan).
5. **Webapp UI** — remove visualizer and chips.
6. **Rename** operating-model “Workflow” headers to avoid future confusion.
7. **Tests** — delete workflow-specific suites; update system-prompt snapshots.

---

## 8. Quick grep commands

```bash
# DAG / skill / CLI (exclude .github/workflows)
rg -i 'workflow' --glob '!**/.github/**' --glob '!**/native-workflow*'

# Prompts only
rg -i 'workflow' services/backend/prompts

# Convex + schema
rg 'chatroom_workflows|workflows\.' services/backend
```
