# Command-Run Integration — Phase 1 Discovery Report

> **Updated 2026-05-22**: `clearStaleCommandRuns` has been removed. Daemon recovery now
> uses `reapOrphansForDaemonRestart` (marks orphaned runs as `killed` with
> `terminationReason: 'daemon-restart'` instead of `stopped`). References to
> `clearStaleCommandRuns` below are preserved for historical context.

## A. Surface Inventory

### Backend: `services/backend/convex/commands.ts` (699 LOC)

- **Responsibility**: God-file containing all Convex mutations/queries for the command-run lifecycle: sync, run, stop, status update, output append, list/query.
- **Public exports** (all Convex functions):
  - Mutations: `syncCommands`, `runCommand`, `stopCommand`, `updateRunStatus`, `appendOutput`, `clearStaleCommandRuns`, `clearStuckCommandRuns`
  - Queries: `listCommands`, `listActiveRuns`, `listRuns`, `getRunOutput`, `getRunStatus`
- **Smell category**: God-file. Contains schema validation, auth checks, state-machine transitions, output management, and stale-run cleanup — 5+ responsibilities in one module.

### Backend: `services/backend/convex/schema.ts` (command-run sections only)

- **`chatroom_runnableCommands`** (15 fields + 1 index): Maps machine+workspace to discoverable commands. Index: `by_machine_workingDir`.
- **`chatroom_commandRuns`** (10 fields + 3 indexes): Status lifecycle record. Status union: `pending | running | completed | failed | stopped | killed`. Fields include `terminationReason`, `pid`, `startedAt`, `completedAt`, `exitCode`, `requestedBy`. Indexes: `by_machine_workingDir`, `by_machine_workingDir_status`, `by_status`.
- **`chatroom_commandOutput`** (4 fields + 1 index): Append-only output chunks per run. Index: `by_runId_chunkIndex`.
- **`chatroom_eventStream`** includes `command.run` and `command.stop` event types.

### Backend test: `services/backend/convex/commands.spec.ts` (274 LOC)

- Unit tests for status transition validation, stop-command edge cases.

### Backend integration test: `services/backend/tests/integration/command-runner.spec.ts` (317 LOC)

- Integration tests for run → stop → replace lifecycle.

### Daemon: `command-runner.ts` (649 LOC)

- **Responsibility**: Spawns processes, captures stdout/stderr, flushes to backend, handles stop/kill/replace, manages soft timeout (24h), graceful shutdown.
- **Public exports**: `onCommandRun`, `onCommandStop`, `shutdownAllCommands`, `evictStalePendingStops`, `deriveTerminalStatus`, `runningProcesses`, `runningProcessesByCommand`, `pendingStops`.
- **Smell**: Second god-file. Spawning, buffering, flushing, event handling, process group management all in one file.

### Daemon test: `command-runner.test.ts` (743 LOC)

- Comprehensive tests for daemon behavior including race conditions, process group killing.

### Daemon: `command-loop.ts` (619 LOC, ~60 LOC of command-run dispatching)

- **Responsibility**: Main daemon event loop. Dispatches `command.run` → `onCommandRun`, `command.stop` → `onCommandStop`. Manages dedup IDs per event type.

### Daemon: `init.ts` (506 LOC, ~15 LOC for command-run recovery)

- Calls `clearStaleCommandRuns` during daemon recovery to clear stale pending/running runs.

### Daemon: `command-sync-heartbeat.ts`

- Calls `api.commands.syncCommands` to push discovered commands.

### Frontend hook: `useCommandRunner.ts` (82 LOC)

- **Responsibility**: Thin hook wrapping Convex subscriptions + mutations for command lifecycle.
- **Public return**: `{ commands, runs, activeRunId, setActiveRunId, activeRunOutput, runCommand, stopCommand }`
- Calls: `listCommands`, `listRuns`, `getRunOutput` (queries); `runCommand`, `stopCommand` (mutations).

### Frontend hook test: `useCommandRunner.test.ts` (122 LOC)

### Frontend: `ProcessManager.tsx` (876 LOC)

- **Responsibility**: Split-pane dialog for command browser + process management. Handles keyboard navigation, search, favorites, clear-stuck, workspace grouping, command detail panels.
- **Smell**: Large component with 5+ sub-components inlined: `CommandDetailPanel`, `WorkspaceDetailPanel`, `ProcessList`, `OutputPanel`. State management for selection, navigation, search, favorites all in one component.

### Frontend: `OutputPanel.tsx` (151 LOC)

- **Responsibility**: Terminal output viewer with auto-scroll, status badge, stop/restart controls.

### Frontend: `ProcessList.tsx` (99 LOC)

- **Responsibility**: Sectioned list of command runs with status icons and action buttons.

### Frontend: `ChatroomDashboard.tsx` (line 736)

- Instantiates `useCommandRunner` with `activeWorkspace.machineId` + `activeWorkspace.workingDir`.
- Passes `commandRunner` values to `ProcessManager`.

---

## B. Public API Surface

### Convex — `api.commands.*`

| Function                | Type     | Callers                                                 |
| ----------------------- | -------- | ------------------------------------------------------- |
| `syncCommands`          | mutation | Daemon (`command-sync-heartbeat.ts`)                    |
| `runCommand`            | mutation | Webapp (`useCommandRunner` → `ProcessManager`)          |
| `stopCommand`           | mutation | Webapp (`useCommandRunner` → `ProcessManager`)          |
| `updateRunStatus`       | mutation | Daemon (`command-runner.ts` — multiple call sites)      |
| `appendOutput`          | mutation | Daemon (`command-runner.ts` flush timer + exit handler) |
| `clearStaleCommandRuns` | mutation | Daemon (`init.ts` — recovery)                           |
| `clearStuckCommandRuns` | mutation | Webapp (`ProcessManager` — user escape hatch)           |
| `listCommands`          | query    | Webapp (`useCommandRunner`)                             |
| `listActiveRuns`        | query    | (defined but no current caller in webapp)               |
| `listRuns`              | query    | Webapp (`useCommandRunner`)                             |
| `getRunOutput`          | query    | Webapp (`useCommandRunner`)                             |
| `getRunStatus`          | query    | Daemon (`command-runner.ts` — pre-spawn check)          |

### Daemon Events (event stream)

| Event          | Emitted By                                  | Consumed By                                           |
| -------------- | ------------------------------------------- | ----------------------------------------------------- |
| `command.run`  | `commands.ts:runCommand` (Convex mutation)  | `command-loop.ts` → `command-runner.ts:onCommandRun`  |
| `command.stop` | `commands.ts:stopCommand` (Convex mutation) | `command-loop.ts` → `command-runner.ts:onCommandStop` |

### Frontend Hook — `useCommandRunner` return shape

| Field             | Type                               | Consumed By                                                                  |
| ----------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| `commands`        | `RunnableCommand[]`                | `ProcessManager` (command browser)                                           |
| `runs`            | `CommandRun[]`                     | `ProcessManager` (process list, detail panels)                               |
| `activeRunId`     | `string \| null`                   | `useCommandRunner` internally + `setActiveRunId` exposed to `ProcessManager` |
| `activeRunOutput` | `{ chunks, run }`                  | `ProcessManager` → `OutputPanel`                                             |
| `runCommand`      | `(name, script) => Promise<runId>` | `ProcessManager` (run/restart buttons)                                       |
| `stopCommand`     | `(runId) => Promise<void>`         | `ProcessManager` (stop buttons)                                              |

---

## C. Status Writers / Readers

### Writers of `commandRuns.status`

| Location                | Context                                     | Status Values Written                                 |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------- |
| `commands.ts:184`       | `runCommand` mutation — replace semantics   | `killed`                                              |
| `commands.ts:197`       | `runCommand` mutation — new run insert      | `pending`                                             |
| `commands.ts:258`       | `stopCommand` mutation — pending skip path  | `stopped`                                             |
| `commands.ts:369`       | `updateRunStatus` mutation — daemon reports | `running`, `completed`, `failed`, `stopped`, `killed` |
| `commands.ts:629`       | `clearStaleCommandRuns` — daemon recovery   | `stopped`                                             |
| `commands.ts:674,683`   | `clearStuckCommandRuns` — user escape hatch | `stopped`                                             |
| `command-runner.ts:474` | exit handler (via `updateRunStatus`)        | depends on `deriveTerminalStatus`                     |
| `command-runner.ts:505` | spawn error handler                         | `failed`                                              |
| `command-runner.ts:533` | `onCommandStop` — no tracked process        | `stopped`                                             |
| `command-runner.ts:573` | `onCommandStop` — SIGKILL fallback          | `stopped`                                             |
| `command-runner.ts:613` | `shutdownAllCommands`                       | `killed`                                              |
| `command-runner.ts:395` | soft timeout handler                        | `killed`                                              |
| `command-runner.ts:420` | initial spawn (pending→running)             | `running`                                             |

### Readers of `commandRuns.status`

| Location                     | Context                                              | What It Checks                                         |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| `commands.ts:328`            | `updateRunStatus` — terminal-state idempotency check | `TERMINAL_STATES.has(run.status)`                      |
| `commands.ts:339`            | `updateRunStatus` — valid transition map lookup      | `validTransitions[run.status]`                         |
| `commands.ts:248-254`        | `stopCommand` — status guard                         | `run.status !== 'running' && run.status !== 'pending'` |
| `commands.ts:627`            | `clearStaleCommandRuns`                              | `run.status === 'pending' \|\| 'running'`              |
| `commands.ts:671,679`        | `clearStuckCommandRuns`                              | status-specific paths                                  |
| `command-runner.ts:295`      | pre-spawn check via `getRunStatus`                   | `TERMINAL_STATES.has(currentRun.status)`               |
| `ProcessManager.tsx:103,223` | process counting                                     | `r.status === 'pending' \|\| 'running'`                |
| `OutputPanel.tsx:97`         | UI rendering                                         | `run.status === 'running' \|\| 'pending'`              |
| `ProcessList.tsx:51`         | UI rendering                                         | `run.status === 'running' \|\| 'pending'`              |

---

## D. Daemon In-Memory State Map

### `runningProcesses` (Map<string, RunningProcess>)

- **Stores**: Active process tracking (ChildProcess, runId, commandKey, outputBuffer, timers, terminationIntent)
- **Written**: `onCommandRun:374` (set), exit handler `:460` (delete), `onCommandStop` via exit handler, `killTrackedProcess` cleanup `:324`
- **Read**: `onCommandRun:258` (dupe check), `onCommandStop:524` (lookup), `shutdownAllCommands:595,638` (snapshot + force-kill), `waitForExit:209` (poll)
- **DB mirror of**: `chatroom_commandRuns` rows with `status === 'running'`
- **Divergence potential**: If daemon crashes without cleanup, `runningProcesses` is lost but DB shows `running`. This is the primary divergence — `clearStaleCommandRuns` on next daemon startup fixes it, but there's a window where the UI shows "running" but no process exists.

### `runningProcessesByCommand` (Map<string, string> → commandKey → runId)

- **Stores**: Composite key `machineId|workingDir|commandName` → current runId
- **Written**: `onCommandRun:375` (set), exit handler `:462-464` (delete if matches), `killTrackedProcess:325`
- **Read**: `onCommandRun:311` (replace semantics lookup)
- **DB mirror of**: Derived from `by_machine_workingDir_status` index
- **Divergence**: Same crash window as `runningProcesses`. Additionally, if a replace race occurs where two runs update this map simultaneously, the exit handler's guard `if (runningProcessesByCommand.get(commandKey) === runIdStr)` prevents deleting a newer entry.

### `pendingStops` (Map<string, number> → runId → timestamp)

- **Stores**: Stop requests received before the corresponding `command.run` event was processed
- **Written**: `onCommandStop:531` (set if no tracked process)
- **Read**: `onCommandRun:264` (check before spawn), `evictStalePendingStops:68` (cleanup)
- **DB mirror of**: No direct DB equivalent — it's purely a race-condition cache. The pre-spawn `getRunStatus` query (line 290) provides the same semantic via DB state.
- **Divergence**: Entries can accumulate if `command.stop` arrives for a run that never gets a corresponding `command.run`. `evictStalePendingStops` cleans up entries older than 60s, so worst-case divergence is 60s of stale entries taking memory.

### `flushTimer`, `softTimeoutTimer` (per-process, on `RunningProcess`)

- **Stores**: Timer references for periodic output flush and 24h timeout
- **Written**: `onCommandRun:365-416`
- **Read**: Clear/cleanup in exit handler, `killTrackedProcess`, `onCommandStop`, `shutdownAllCommands`
- **DB mirror of**: No DB equivalent — purely ephemeral.

---

## E. Smell Ratings per File

### `services/backend/convex/commands.ts` — HIGH

1. **God-file** (line 1-699): Contains 7 mutations + 5 queries — auth, state machine, output management, stale cleanup, and dedup logic all in one module.
2. **Duplicated state machine** (line 335-338): The `validTransitions` map is defined inline as a plain object. The same logic is implicitly enforced in `stopCommand` (line 248). The `TERMINAL_STATES` set (line 34) duplicates `command-runner.ts:77`.
3. **Mixed abstraction levels**: `runCommand` mixes auth checks, security validation, dedup, replace-semantics, DB insert, and event dispatch in one handler (lines 119-214). The `run` → `killed` transition for replace (line 184) is done directly via `ctx.db.patch`, not through `updateRunStatus` — bypassing the state machine intentionally, but silently.
4. **Two "clear stuck" mutations with overlapping behavior**: `clearStaleCommandRuns` (daemon-startup, machine-wide) and `clearStuckCommandRuns` (user escape hatch, workspace-scoped) share ~80% of their logic.

### `packages/cli/src/commands/machine/daemon-start/handlers/command-runner.ts` — HIGH

1. **God-file** (line 1-649): Spawn logic, output buffering, flush scheduling, stop/kill/replace, shutdown, process group management, pending-stop race handling — 6+ responsibilities.
2. **Duplicated state constants**: `TERMINAL_STATES` (line 77) duplicates `commands.ts:34`. `OUTPUT_FLUSH_INTERVAL_MS`, `SOFT_TIMEOUT_MS`, `SIGTERM_GRACE_PERIOD_MS` are daemon-only but could be config.
3. **`any` casts throughout**: `status: 'failed' as any` (lines 135, 274, 478, etc.) and `runId: tracked.runId as any` — the `api.commands.*` function type is not matching the daemon's internal types cleanly.
4. **Implicit unwind logic**: `onCommandStop` (line 522) sets `terminationIntent`, sends SIGTERM, polls for exit, escalates to SIGKILL — all in one function. The exit handler and shutdown path each have their own parallel versions of this logic.
5. **`shutdownAllCommands`** (line 594) is a third copy of the cleanup logic with a different intent string (`'daemon-shutdown'`).

### `apps/webapp/src/modules/chatroom/components/ProcessManager/ProcessManager.tsx` — MEDIUM

1. **Component size** (876 LOC): Contains 3 inlined panels (`CommandDetailPanel`, `WorkspaceDetailPanel`, `CommandPanel`) plus the main `ProcessManager` component. These should be separate files.
2. **Mixed ownership**: `selectedCommand`/`selectedWorkspace` navigation state lives in ProcessManager but is tightly coupled to keyboard nav and search. The "active run" selection flow (`onSelectRun` → `setActiveRunId` in hook) creates a cross-cutting concern where the hook manages which run's output to display, but the component manages which command/workspace is selected.
3. **`CommandDetailPanel`** and `WorkspaceDetailPanel` are defined as inner components (lines 597-750, 754-876) — cannot be unit-tested independently, encouraging future scope creep in ProcessManager.

### `apps/webapp/src/modules/chatroom/hooks/useCommandRunner.ts` — LOW

1. **Acceptable size** (82 LOC). The hook is thin and well-focused.
2. **Minor**: `activeRunId` is state in the hook that can diverge from the runs list — if a run completes while it's the `activeRunId`, `getRunOutput` will still return data but the run's output won't update. This is by design but worth noting.
3. **`as any` casts for `runId`** (lines 39, 68): The `Id` type from Convex doesn't flow through cleanly.

### `apps/webapp/src/modules/chatroom/components/ProcessManager/OutputPanel.tsx` — LOW

1. **Clean separation of concerns**: Presentational component, no business logic.
2. **Minor**: `StatusBadge` is an inner component (line 27) — trivial enough to inline or trivial enough to extract, but extraction to its own file would improve testability.

### `apps/webapp/src/modules/chatroom/components/ProcessManager/ProcessList.tsx` — LOW

1. **Clean, focused component** at 99 LOC.
2. **Suggested**: Extract `StatusIcon` (line 19) into a shared module if it's used elsewhere, or rename to match `OutputPanel`'s `StatusBadge` for consistency.

### `packages/cli/src/commands/machine/daemon-start/command-loop.ts` — LOW (command-run portion)

1. **Event dispatch is clean** (lines 314-329). The dedup-ID strategy is well-documented.
2. **Minor**: The `event as any` casts on lines 324, 328 erode type safety.

---

## F. Proposed Target Architecture

### Module Map

```
services/backend/convex/
├── commands/
│   ├── commands.schema.ts        # Schema types, Status enum, shared constants
│   ├── commands.mutations.ts     # runCommand, stopCommand, appendOutput
│   ├── commands.queries.ts       # listCommands, listRuns, getRunOutput, getRunStatus
│   ├── commands.daemon.ts        # syncCommands, updateRunStatus, clearStaleCommandRuns (daemon-facing)
│   └── commands.fsm.ts           # Typed FSM: status transitions, terminal-state checks
```

**Rationale**: Decompose the 699-line god-file into 5 focused modules.

- `commands.schema.ts`: Exports the `CommandRunStatus` union, `TERMINAL_STATES` set, `ValidTransitions` map as typed constants. Single source of truth for status-related types. Absorbs lines 22-35 from current `commands.ts`.
- `commands.fsm.ts`: Exports `isValidTransition(from, to): boolean`, `isTerminal(status): boolean`, `assertValidTransition(from, to)`. Typed FSM extracted from the inline map at lines 335-338. Unit-testable without DB.
- `commands.mutations.ts`: User-facing mutations (`runCommand`, `stopCommand`, `appendOutput`). Uses `commands.fsm.ts` for transitions where applicable.
- `commands.queries.ts`: User-facing queries (`listCommands`, `listRuns`, `getRunOutput`, `getRunStatus`, `listActiveRuns`).
- `commands.daemon.ts`: Daemon-facing functions (`updateRunStatus`, `syncCommands`, `clearStaleCommandRuns`, `clearStuckCommandRuns`). Separated because they have different auth models (owner vs write-access) and are only called by the daemon.

```
packages/cli/src/commands/machine/daemon-start/
├── process/
│   ├── process-manager.ts         # Single in-memory state store for tracked processes
│   ├── process-spawner.ts         # Spawn logic, working-directory validation, security checks
│   ├── process-output-buffer.ts   # Output buffering, flush scheduling, MAX_BUFFER_SIZE
│   ├── process-killer.ts          # Signal delivery, SIGTERM→SIGKILL escalation, process group kill
│   └── process-state.ts           # RunningProcess type, deriveTerminalStatus
```

**Rationale**: Decompose the 649-line god-file into 5 focused modules.

- `process-state.ts`: Exports `RunningProcess` type, `deriveTerminalStatus` (already standalone), constants. Single source for shared process data structures.
- `process-manager.ts`: Exports `ProcessManager` class handling all in-memory state (`runningProcesses`, `runningProcessesByCommand`, `pendingStops`). Single source of truth for daemon-side process tracking. Absorbs `evictStalePendingStops`, `waitForExit`.
- `process-spawner.ts`: Exports `spawnProcess()` — working-dir validation, security check, `sh -c` spawn, PID tracking. Returns a `RunningProcess`.
- `process-output-buffer.ts`: Exports `createOutputBuffer()`, `appendToBuffer()`, `flushOutput()`. Timer management for periodic flush.
- `process-killer.ts`: Exports `killProcess()`, `killTrackedProcess()`, `killProcessGroup()`. Signal escalation logic.

```
apps/webapp/src/modules/chatroom/components/ProcessManager/
├── ProcessManager.tsx          # Shell: search, keyboard nav, layout, children wiring
├── CommandBrowser.tsx          # Command search + workspace listing (extracted from ProcessManager)
├── CommandDetailPanel.tsx      # Extracted from inner component (currently at line 597)
├── WorkspaceDetailPanel.tsx    # Extracted from inner component (currently at line 754)
├── ProcessList.tsx             # (as-is, 99 LOC)
├── OutputPanel.tsx             # (as-is, 151 LOC)
├── StatusBadge.tsx             # Shared status icon + label component (extracted from OutputPanel)
└── StatusIcon.tsx              # Shared icon component (extracted from ProcessList)
```

**Rationale**: Reduce ProcessManager.tsx from 876 LOC → ~300 LOC by extracting the 3 inlined panels.

### Migration Order

1. **Extract `commands.fsm.ts`** (backend) — zero-risk, pure logic, no schema changes, adds unit-testable transition validation. Unblocks all other backend extractions.

2. **Extract `commands.schema.ts`** (backend) — move type constants. Update imports.

3. **Extract `commands.daemon.ts`** (backend) — `updateRunStatus`, `syncCommands`, `clearStaleCommandRuns`, `clearStuckCommandRuns`. These have a distinct caller (daemon vs user) and auth model (owner vs write-access). Moving them clarifies the boundary.

4. **Extract `commands.mutations.ts`** and **`commands.queries.ts`** (backend) — remaining user-facing functions. One PR per extraction.

5. **Extract daemon process modules** (1-2 PRs):
   - First: `process-state.ts` + `process-manager.ts` (collapses 3 maps into one typed store)
   - Second: `process-spawner.ts` + `process-output-buffer.ts` + `process-killer.ts`

6. **Extract frontend panels** (1 PR): Extract `CommandDetailPanel`, `WorkspaceDetailPanel`, `StatusBadge`, `StatusIcon` as separate files. No behavior changes.

---

## G. Long-Running Handling Within Existing Model

### Current behavior

A dev server (e.g., `next dev`, `convex dev`) follows the exact same lifecycle as a one-shot command:

1. Spawned with `detached: true` as process group leader.
2. Output is buffered and flushed every 3 seconds.
3. On exit, `deriveTerminalStatus` (command-runner.ts:115) determines the status:
   - `terminationIntent` set → use it (`killed` or `stopped`)
   - exit code 0 → `completed`
   - non-null signal → `stopped`
   - non-zero exit → `failed`

### The problem

When a user explicitly stops a dev server via the UI (`stopCommand`):

- `stopCommand` sets `terminationReason: 'user-stop'` in DB.
- Daemon receives `command.stop` event → `onCommandStop` sets `terminationIntent = 'stopped'` → sends SIGTERM → process exits → exit handler reports `status: 'stopped'`.
- ✅ This is handled correctly. The `terminationIntent` mechanism ensures the signal-derived status reflects user intent.

When a dev server crashes (e.g., port conflict, compilation error):

- Process exits with non-zero code → `deriveTerminalStatus` returns `'failed'`.
- ✅ Correct behavior.

When a dev server exits cleanly (code 0) — e.g., the user kills it outside of the daemon:

- `terminationIntent` is null, exit code is 0 → `deriveTerminalStatus` returns `'completed'`.
- ❌ **This is a real bug**: A dev server that exits with code 0 on its own (e.g., crashed, or the user hit Ctrl+C outside the daemon's managed stop) is treated as a successful completion. The UI shows a green checkmark — "Completed" — which is misleading for a long-running process that should never exit.

### The SIGTERM-based stop race

The daemon sends SIGTERM (graceful). If the process exits with code 0 in response to SIGTERM:

- `deriveTerminalStatus` returns `terminationIntent` (set to `'stopped'`) — ✅ correct.
- But if `terminationIntent` was NOT set (e.g., SIGTERM from outside the daemon) and the process exits with code 0 → `'completed'` — ❌ wrong for long-running.

### What the refactor can improve (no new fields)

1. **Centralize `deriveTerminalStatus`** in the extracted FSM module so all three daemon call sites (exit handler, spawn error, shutdown) use the identical logic.
2. **Make `terminationIntent` required** in the state machine — every terminal status decision goes through `deriveTerminalStatus` rather than three separate inline paths.
3. **Flag for separate fix**: The exit-code-0-as-completed for dev servers is a real bug that exists within the current model. It's not caused by the refactor scope — it's a pre-existing semantic gap. Recommend fixing separately by teaching the daemon or backend to treat exit-code-0-as-unexpected for any process that was not explicitly stopped by the user. This could be done with zero schema changes (e.g., if `terminationIntent` is null and the process was not stopped via the event stream, treat exit 0 as `failed` for long-running processes — but detecting "long-running" currently requires an ad-hoc heuristic since there's no `runType` field).
