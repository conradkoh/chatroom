# Cursor SDK reliability incident report & follow-up plan

**Chatroom:** `n574xcqabp64vb1qwrh3hwvfxs86mh16`  
**Team:** Duo (planner `cursor-sdk`, builder `opencode-sdk`)  
**Window:** 2026-06-24 ~15:48–17:24  
**Branch at analysis time:** `feat/native-multiagent-integration`

---

## Executive summary

Three failure modes appear in the captured logs:

1. **Planner crash + incomplete recovery (17:15)** — SDK run failed; crash recovery tried daemon-memory resume; resume failed; no evidence recovery finished (no new spawn, no `native:waiting`).
2. **Task-monitor race on restart (17:23:27)** — Native nudge retried injection on a task already `acknowledged`, causing an uncaught backend error.
3. **Planner behavior on a simple user question (17:23:31–17:24)** — Expensive duplicated tooling, wrong verification scope, session text after handoff, stale “builder was online earlier” narrative.

**Fixes already committed (not yet deployed in the 17:15 incident):**

| Commit      | Change                                                                                         |
| ----------- | ---------------------------------------------------------------------------------------------- |
| `9d7baeb3d` | Recipient visibility callouts in handoff templates                                             |
| `41ffe9860` | Team composition vs “builder available” in system prompt                                       |
| `57a53c776` | Cold restart after SDK `run-error`; task-monitor native revive for stale PIDs                  |
| `21e7c0385` | Native handoff reliability; remove `report-progress`; turn-end guidance                        |
| `dcc006185` | Remove `classify`; inline task delivery; token-driven `in_progress` (no mandatory `task read`) |

**Post-fix validation (2026-06-24 19:05):** Planner ↔ builder connectivity test succeeded with inline native injection, no `task read`, both harnesses returning to `native:waiting`. See [agent-intake-cleanup.md](./agent-intake-cleanup.md).

---

## Phase 1 — Earlier session (15:48)

Builder (`opencode-sdk`) handed off to planner: _“Confirmed builder availability — online and ready…”_

That established a prior successful planner→builder→planner round-trip. Later planner turns treat that as ground truth even though availability can change after daemon restarts, harness crashes, or `sessionResumeFailed`.

**Anomaly:** Historical handoff success used as a **presence signal** (not supported by the system).

---

## Phase 2 — Planner crash loop (17:15:26–17:16:10)

| Time        | Event                                                            |
| ----------- | ---------------------------------------------------------------- |
| (earlier)   | `sessionResumeFailed` for **builder**                            |
| 17:15:41    | `cursor-sdk:planner status: RUNNING`                             |
| immediately | `status: ERROR` + `run-error` (no SDK detail)                    |
| right after | `harness start … wantResume=true reason=platform.crash_recovery` |
| right after | `sessionResumeFailed` for **planner**                            |
| 17:16:10    | Heartbeat only — no spawn success, no `native:waiting`           |

### Anomalies

- **Opaque SDK failure** — `status: 'error'` with empty `result`; root cause unknown.
- **Resume-first recovery on failed run** — pre-`57a53c776` behavior retained harness session and retried `Agent.resume`.
- **Incomplete recovery** — no follow-up spawn / `native:waiting` / explicit failure before user `^C`.
- **Split-brain risk** — backend may show `desiredState=running` + stale PID while daemon slot is idle.

---

## Phase 3 — Daemon restart (17:22:57–17:23:23)

- PM2 restart raced old PID (`52798`); new daemon `58122`.
- `Recovery: 0 killed, 1 cleaned up` — stale entry removed; **no agents resurrected**.
- Pending work not replayed until `user.start` / task monitor.

---

## Phase 4 — Task-monitor race (17:23:27)

```
agent.requestStart → planner (user.start)
agent.requestStart → builder (user.start)
[TaskMonitor] native nudge planner — retrying injection for pending task nh743msk...
native injection failed: Task must be pending to claim (current status: acknowledged)
```

**Root cause:** `processTasksUpdate` can run **inject** (`shouldInjectNativeTask` → `claimTask`) and **nudge** (`shouldNudgeNativeInjection` → clear dedup → inject again) on the same task in one tick. First claim wins; second throws.

**Status:** Not fixed yet — highest-impact follow-up.

---

## Phase 5 — Planner on “is builder online?” (17:23:31–17:24)

| Anomaly                 | Detail                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| Over-tooling            | Many `chatroom --help` / `context read` / `machine harness status` calls |
| Duplicate tool lines    | Same bash commands logged twice (SDK stream duplication)                 |
| `handoff view-template` | Native agents get templates via task delivery; CLI fetch is redundant    |
| Verification misfire    | `pnpm typecheck && pnpm test` for a meta question with no code changes   |
| Stale evidence          | Handoff cites 15:48 builder check, not post-restart state                |
| User visibility         | Session text after handoff (`Short answer:…`) — invisible in UI          |
| Healthy ending          | `lifecycle.turn.completed` → `native:waiting` ✓                          |

---

## Recommended follow-ups (priority)

### P0 — Reliability

1. **Task monitor:** Skip `claimTask` when status ≠ `pending`; catch errors in injection fork; avoid inject+nudge on same task per tick.
2. **Deploy `57a53c776`:** Cold restart after `run-error`; native revive for stale PIDs.
3. **Observability:** Log explicit outcome after `sessionResumeFailed` (`cold spawn started` / `spawn failed: …`).

### P1 — Prompt / agent behavior

4. Skip `pnpm typecheck && pnpm test` for non-code / connectivity / meta tasks (prompt-level; classify removal means no `question` classification gate).
5. Discourage `handoff view-template` for native harnesses (templates inlined on task delivery).
6. Discourage inferring agent presence from team config or old handoff history (`41ffe9860`).

**Addressed by `dcc006185`:** mandatory `classify` and `task read` at intake removed; activity is harness stdout via `updateTokenActivity`.

### P2 — SDK

7. Log full `RunResult` JSON on Cursor SDK errors when `result` is empty.

---

## Workflow mention in planner reasoning

In the 17:23 session the planner’s thinking repeatedly refers to **“the workflow”** requiring handoff to the user. That language is **not** primarily from the DAG `workflow` skill — it comes from **role operating-model prompts**:

| Source                                       | Text pattern                                         |
| -------------------------------------------- | ---------------------------------------------------- |
| `prompts/cli/roles/planner.ts`               | Was `## Planner Workflow` → now **Operating model**  |
| `prompts/teams/duo/prompts/planner.ts`       | Mermaid from `getPlannerPlusBuilderOperatingModel()` |
| `prompts/cli/sections/operating-model.ts`    | `**Operating model: Planner + Builder**` diagram     |
| Handoff rules / task delivery `<next-steps>` | “MUST run handoff command” to `user`                 |
| `prompts/cli/roles/builder.ts`               | DAG “workflow step” block **removed** (`d92b54e79`)  |

Agents may still say “workflow” colloquially. Operating-model sections are renamed; DAG `chatroom workflow` is removed.

See **[workflow-removal-inventory.md](./workflow-removal-inventory.md)** for full removal map.
