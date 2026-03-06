# Backlog Review — 2026-03-06

## Context

This document summarizes:
1. The full backlog as of 2026-03-06 (20 items)
2. Analysis of stale/closeable items
3. Proposed batching plan for implementation

Current branch: `master` (HEAD: `9f6d0409`)

---

## Full Backlog

| # | ID | Title | Created |
|---|---|---|---|
| 1 | k173mk010dq1evzz6nn49hcb4x81e97g | Bug: Daemon restart → active agents should be marked offline | Feb 19 |
| 2 | k178dhp9pyxdtvn1kz2p5re9ms813ks0 | Edit Pending/Queued Messages | Feb 13 |
| 3 | k172mxy39qy7fcvff8tgdd2a25812mek | Delete Pending Messages | Feb 13 |
| 4 | k17chjvnh19r0vxejdv38nxzbn818yqd | UX: Attached tasks UX issues (markdown + clickable) | Feb 16 |
| 5 | k171z6tzyk9nhs6tb0n0m3d42181v5mq | Refactor: Consolidate duplicate teamRoleKey implementations | Feb 26 |
| 6 | k17am00esqvstek41e66b9sdan81ca7w | Debug: Convex mutation conflict (touchSession) | Feb 18 |
| 7 | k17245gnsv6aefehznb35ezjxn7zvvcv | Improve prompts for incremental progress reporting | Jan 25 |
| 8 | k17bfxy4hgk5a9gryk7qg5fcdh81bam9 | Improvement: Long horizon tasks (externalize plan) | Feb 18 |
| 9 | k17552d26g3dhxkm4t1mk84ngd81bvqj | Team: Solo (single-agent team) | Feb 17 |
| 10 | k179xe0fbead1zehkqz6976rt5821373 | Prompt Source Tracing (XML metadata tags) | Feb 28 |
| 11 | k172vfnf4dkzphxf4j85ns41fn81am43 | Improvement: Restore opencode sessions across restarts | Feb 18 |
| 12 | k17281x9nhmejxkf5q89491g4h82a60g | UI: cmd+k empty state has no padding | Mar 6 |
| 13 | k175q5x0pdev047bhy5qppe6qx82a6rb | Feature: chatroom skills CLI command | Mar 6 |
| 14 | k174yv15hqe1fvd5tyvrv85n8x82a122 | Code Cleanup: remove hardcoded .js extensions | Mar 6 |
| 15 | k1730ktfs4yd3fdkak3tjec8px82baxc | Verify: immediate auto-restart after process exit | Mar 5 |
| 16 | k175rdg472yez5bkqzwcqf9ew582aagx | Add support for cursor agent CLI | Mar 5 |
| 17 | k17fkfmzjakrfv2qw4k6fsx89s82bzz2 | New chatroom default team = duo (not pair) | Mar 5 |
| 18 | k172jym7nwzsth2ht8wpgv98rn82awkh | Bug: Setup screen Start button doesn't open config dialog | Mar 5 |
| 19 | k179tbbf9pygckn5g4qhnan7n582apyy | Bug: Acknowledged backlog task → pending_user_review not triggered | Mar 5 |
| 20 | k17c7wncstfrvgr6kcw1vtg42s824w15 | UI: Model blacklist list height too small (50%) | Mar 2 |

---

## Stale / Closeable Analysis

### ❌ Close: #14 (js extensions)

The backlog item says "remove all hardcoded `.js` extensions." This is **too broad and partially incorrect**:

- **`packages/cli`** (347 imports with `.js`): **Required**. The CLI is `"type": "module"` ESM — Node.js requires explicit `.js` extensions for runtime resolution. Removing them breaks the CLI.
- **`apps/webapp`** (0 imports with `.js`): Correct — Next.js bundler handles resolution.
- **`services/backend`** (3 imports with `.js`): These are inconsistent. Convex's bundler may not need them. Worth investigating/cleaning up, but it's a 3-file fix, not a full sweep.

**Recommendation**: Close #14 as written. If there's a real concern about the 3 backend files, open a more targeted ticket.

### ⚠️ Partially Addressed: #15 (auto-restart verification)

The implementation already exists:
- `onAgentExited` → schedules `ensureAgentHandler.check` for crash recovery
- Circuit breaker (#22) prevents infinite restart loops
- `desiredState: 'stopped'` guard respects explicit user stops

**Recommendation**: Verify manually. If it works, close it or add an integration test.

### ⚠️ Partially Addressed: #1 (daemon restart → agents offline)

Current behavior:
- **Graceful shutdown** (SIGTERM): `onDaemonShutdown` marks daemon disconnected → agents appear offline ✅
- **Crash** (SIGKILL / kill -9): stale daemon detection fires after 2-min TTL ✅
- **Daemon restart**: `recoverAgentState` clears stale PIDs on startup ✅
- **Remaining gap**: participant records not cleaned up until 2-min TTL — agents appear "online" (participant exists) even if daemon died unexpectedly

**Recommendation**: Keep open but reduce severity. The 2-min window is the remaining edge case.

---

## Batch Plan

### Batch A — Small UI Bugs (1 PR)
**Items:** #12, #17, #20
- #12: Add padding to cmd+k empty state
- #17: Change default new chatroom team from pair → duo
- #20: Increase model blacklist panel height by 50%

**Scope**: Webapp only. 3 isolated CSS/component tweaks. Fast.

---

### Batch B — Agent Configuration UX (1 PR)
**Items:** #18
- #18: Setup screen Start button should open agent config dialog

**Scope**: Webapp — `SetupChecklist.tsx` component fix.

---

### Batch C — Message Management (1 PR)
**Items:** #2, #3
- #2: Edit pending/queued messages
- #3: Delete pending messages

**Scope**: Backend mutation + webapp UI. Natural pair — both touch the same message table.

---

### Batch D — Agent Lifecycle (1 PR)
**Items:** #1, #15
- #1: Clean up participant records immediately on daemon crash (reduce 2-min window)
- #15: Integration test for auto-restart after process exit

**Scope**: Backend event handling + CLI daemon shutdown. Builds on existing circuit breaker work.

---

### Batch E — Code Quality (1 PR)
**Items:** #5
- #5: Consolidate duplicate `teamRoleKey` implementations (currently 4 inline/separate implementations)

**Scope**: Backend refactor. Extract shared utility, add tests verifying setter/getter parity.

(Note: #14 is closed; the 3 backend `.js` extension files can be addressed as part of #5 cleanup if desired.)

---

### Batch F — Attached Tasks UX (1 PR)
**Items:** #4
- #4: Attached task chip: render markdown (stripped), make clickable to show task detail

**Scope**: Webapp — `SendForm.tsx` + task detail component.

---

### Bugs Needing Investigation First
**Items:** #6, #19
- #6: Convex mutation conflict (touchSession write conflict)
- #19: Acknowledged backlog task not transitioning to pending_user_review

These need reproduction and root cause analysis before implementation.

---

### Deferred (Large Scope / Design Needed)
**Items:** #7, #8, #9, #10, #11, #13, #16

| # | Item | Why Deferred |
|---|---|---|
| #7 | Improve incremental progress prompts | Prompt engineering, needs design |
| #8 | Long horizon tasks (externalize plan) | Large scope — separate initiative |
| #9 | Team: Solo | New team type — significant backend + frontend |
| #10 | Prompt source tracing (XML tags) | Prompt system refactor |
| #11 | Restore opencode sessions | Complex assumptions to validate first |
| #13 | chatroom skills CLI | New CLI design pattern — design first |
| #16 | Cursor agent CLI | New harness integration — significant |

---

## Suggested Implementation Order

1. **Batch A** — Small UI fixes (fast wins)
2. **Batch C** — Message management (well-scoped)
3. **Batch D** — Agent lifecycle (build on recent work)
4. **Batch E** — Code quality (reduce tech debt)
5. **Batch B** — Setup dialog fix
6. **Batch F** — Attached tasks UX
7. **Investigate** — #6 and #19 (debug first, then implement)
8. **Deferred** — as separate initiatives

---

*Document created: 2026-03-06*
*Branch at time of writing: master @ 9f6d0409*
