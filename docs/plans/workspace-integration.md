# Workspace Integration Plan

## Overview

Each chatroom may reside in one or more workspaces (determined by the `workingDir` of agents). This plan covers three features:

1. **Diff Reporting** — high-level overall diff + per-file code review for current changes
2. **Current Branch Reporting** — show what branch we are currently on in the workspace
3. **Git History** — view git log for current branch, click commits to see file diffs

---

## 1. Architecture Decision

### Recommended: Push-on-Heartbeat Model

**Decision: Daemon pushes git state to Convex on every heartbeat (every 30s).**

#### Rationale

| Factor | Push-on-Heartbeat | On-Demand Command |
|--------|-------------------|-------------------|
| Data freshness | Good (30s lag max) | Excellent (immediate) |
| Implementation complexity | Low | High |
| Backend complexity | Minimal (upsert) | Complex (command/response) |
| UX | Always-up-to-date display | Requires user trigger |
| Works when UI closed | Yes (data pre-fetched) | No |
| Consistency with existing patterns | ✅ matches `daemonHeartbeat` + `refreshCapabilities` | Requires new event types |

The heartbeat model aligns with existing patterns in the codebase:
- `daemonHeartbeat` already fires every 30s in `command-loop.ts`
- `refreshCapabilities` also fires on a timer (model refresh, 5 min)
- Git diff/branch/log are cheap read operations — running them every 30s is fine

On-demand would require: new `workspace.requestGitRefresh` event type in schema, new command-loop handler, new `getDaemonPongEvent`-style query, and React polling logic. This is significantly more complex for marginal UX benefit.

#### Data Flow

```
Daemon (heartbeat, every 30s)
  → runs git commands (branch, diff --stat, log, diff)
  → calls mutation: machines.upsertWorkspaceGitState
  → Convex upserts chatroom_workspaceGitState table

Frontend
  → useSessionQuery(api.machines.getWorkspaceGitState, { machineId, workingDir })
  → Convex real-time subscription (live updates on upsert)
  → WorkspaceGitPanel renders branch / diff / history
```

#### Key Design Points

- Git state is keyed by `machineId + workingDir` — workspace-level, not chatroom-level
- This means if two chatrooms share the same workspace, they see the same git state (correct behavior)
- Full diff content (`git diff`) is stored as a string; per-file parsing happens on the frontend
- Recent commits (`git log -20`) are stored as structured JSON
- Commit detail (full diff for a SHA) is **not** pre-fetched — it's requested on-demand via a separate mutation (too large to store for all 20 commits)

#### Commit Detail: On-Demand via Mutation + Separate Table

For commit details (`git show <sha>`), we use a hybrid: daemon writes commit diffs to a separate `chatroom_workspaceCommitDetail` table when requested by the frontend (via a new `workspace.requestCommitDetail` event). This keeps the heartbeat payload small.

Alternatively (simpler): fetch commit detail lazily, store the last N viewed commits in the table, keyed by `machineId + workingDir + sha`. The daemon polls `getWorkspaceCommitRequests` on heartbeat and processes pending requests.

---

## 2. Backend Schema Changes

### New Table: `chatroom_workspaceGitState`

```typescript
chatroom_workspaceGitState: defineTable({
  // Identity: unique workspace
  machineId: v.string(),
  workingDir: v.string(),

  // Branch info
  branch: v.string(),           // e.g. "main", "feat/my-feature", "HEAD" (detached)
  isDirty: v.boolean(),         // true if working tree has uncommitted changes

  // Diff summary (git diff --stat)
  diffStat: v.optional(v.object({
    filesChanged: v.number(),
    insertions: v.number(),
    deletions: v.number(),
  })),

  // Full diff content (git diff, up to ~500KB cap)
  // Stored as raw unified diff string; parsed client-side per-file
  diffContent: v.optional(v.string()),

  // Recent commits (git log --oneline -20 --format=...)
  recentCommits: v.optional(v.array(v.object({
    sha: v.string(),             // full SHA
    shortSha: v.string(),        // 7-char short SHA
    message: v.string(),         // commit message (first line)
    author: v.string(),          // author name
    date: v.string(),            // ISO 8601 date string
  }))),

  // Last time git state was pushed by the daemon
  updatedAt: v.number(),
})
  .index('by_machine_workingDir', ['machineId', 'workingDir'])
```

### New Table: `chatroom_workspaceCommitDetail`

```typescript
chatroom_workspaceCommitDetail: defineTable({
  machineId: v.string(),
  workingDir: v.string(),
  sha: v.string(),              // full commit SHA

  // git show <sha> output (stat + full patch)
  diffContent: v.string(),      // raw unified diff string

  // Derived stats from the commit
  filesChanged: v.number(),
  insertions: v.number(),
  deletions: v.number(),

  updatedAt: v.number(),
})
  .index('by_machine_workingDir_sha', ['machineId', 'workingDir', 'sha'])
```

### New Table: `chatroom_workspaceCommitRequests`

```typescript
chatroom_workspaceCommitRequests: defineTable({
  machineId: v.string(),
  workingDir: v.string(),
  sha: v.string(),
  status: v.union(v.literal('pending'), v.literal('done'), v.literal('error')),
  requestedAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_machine_workingDir', ['machineId', 'workingDir'])
  .index('by_machine_workingDir_sha', ['machineId', 'workingDir', 'sha'])
```

---

## 3. Backend Mutations/Queries

### New file: `services/backend/convex/workspaces.ts`

```typescript
// Mutations (called by daemon):
export const upsertWorkspaceGitState = mutation(...)
// - Args: SessionIdArg, machineId, workingDir, branch, isDirty, diffStat, diffContent, recentCommits
// - Upserts chatroom_workspaceGitState by machineId + workingDir
// - Auth: validates machine ownership (same pattern as machines.ts)

export const upsertCommitDetail = mutation(...)
// - Args: SessionIdArg, machineId, workingDir, sha, diffContent, filesChanged, insertions, deletions
// - Upserts chatroom_workspaceCommitDetail
// - Called by daemon when processing a commit detail request

export const requestCommitDetail = mutation(...)
// - Args: SessionIdArg, machineId, workingDir, sha
// - Inserts a pending chatroom_workspaceCommitRequests row (idempotent)
// - Called by frontend when user opens a commit

// Queries (called by frontend):
export const getWorkspaceGitState = query(...)
// - Args: SessionIdArg, machineId, workingDir
// - Returns chatroom_workspaceGitState row or null

export const getCommitDetail = query(...)
// - Args: SessionIdArg, machineId, workingDir, sha
// - Returns chatroom_workspaceCommitDetail row or null

export const getWorkspaceCommitRequests = query(...)
// - Args: SessionIdArg, machineId (all pending requests for this machine)
// - Returns pending chatroom_workspaceCommitRequests rows
// - Polled by daemon on heartbeat
```

---

## 4. CLI/Daemon Changes

### Heartbeat Extension: `packages/cli/src/commands/machine/daemon-start/command-loop.ts`

In `startCommandLoop`, add git state push **inside the heartbeat timer** (every 30s):

```typescript
const heartbeatTimer = setInterval(() => {
  // Existing heartbeat
  ctx.deps.backend.mutation(api.machines.daemonHeartbeat, {...})

  // New: push git state for all active workspaces
  pushGitStateForAllWorkspaces(ctx).catch(...)

  // New: process pending commit detail requests
  processCommitDetailRequests(ctx).catch(...)
}, DAEMON_HEARTBEAT_INTERVAL_MS);
```

### New file: `packages/cli/src/infrastructure/git/git-reader.ts`

Wraps all git command execution:

```typescript
export interface GitBranchInfo {
  branch: string;
  isDirty: boolean;
}

export interface GitDiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

// Git commands to run:
// git rev-parse --abbrev-ref HEAD         → branch name
// git status --porcelain                  → isDirty (non-empty = dirty)
// git diff --stat                         → diff stat (insertions/deletions/files)
// git diff                                → full diff content (cap at 500KB)
// git log -20 --format="%H|%h|%s|%an|%aI" → recent commits
// git show <sha> --format="" --stat -p    → commit detail
```

### New file: `packages/cli/src/infrastructure/git/push-git-state.ts`

```typescript
// pushGitStateForAllWorkspaces(ctx)
// 1. Collect all active workingDirs from ctx (tracked via agent configs)
// 2. For each workingDir, run git commands via git-reader
// 3. Call api.workspaces.upsertWorkspaceGitState with results
// 4. Cap diffContent at 500KB to avoid Convex document size limits
```

### New file: `packages/cli/src/infrastructure/git/process-commit-requests.ts`

```typescript
// processCommitDetailRequests(ctx)
// 1. Query api.workspaces.getWorkspaceCommitRequests for pending requests
// 2. For each pending request, run: git show <sha> --format="" --stat -p
// 3. Call api.workspaces.upsertCommitDetail
// 4. Mark request as done
```

### Modified file: `packages/cli/src/commands/machine/daemon-start/command-loop.ts`

- Import and call `pushGitStateForAllWorkspaces` and `processCommitDetailRequests` inside heartbeat

### Workspace Tracking in DaemonContext

The daemon needs to know which `workingDir` values are active. These are already stored on `chatroom_teamAgentConfigs` (available via agent configs). The daemon can read them from there, or we can track them in `DaemonContext` as a `Set<string>` updated when agents start/stop.

Simplest approach: query `chatroom_teamAgentConfigs` for this machine on each heartbeat to get the current set of active `workingDir` values.

---

## 5. Frontend Layers

### Hooks Layer

**New file: `apps/webapp/src/modules/chatroom/hooks/useWorkspaceGit.ts`**

```typescript
// useWorkspaceGit(machineId: string, workingDir: string)
// - Calls useSessionQuery(api.workspaces.getWorkspaceGitState, { machineId, workingDir })
// - Returns: { branch, isDirty, diffStat, diffContent, recentCommits, updatedAt } | null

// useWorkspaceCommitDetail(machineId: string, workingDir: string, sha: string | null)
// - Calls useSessionQuery(api.workspaces.getCommitDetail, { machineId, workingDir, sha })
//   only when sha is non-null
// - Returns the commit detail row or null
```

### View Components

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitBranch.tsx`**
- Displays branch name with a `GitBranch` icon (from `lucide-react`)
- Shows a yellow dot (or "dirty" badge) when `isDirty` is true
- Shows `diffStat` summary: "3 files changed, +45 -12" in muted text
- Accepts: `{ branch: string; isDirty: boolean; diffStat?: DiffStat }`

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceDiffViewer.tsx`**
- Renders the full `diffContent` string (unified diff)
- Parses unified diff client-side into per-file sections (split on `diff --git`)
- Each file section is collapsible (click to expand/collapse)
- Diff hunks rendered with syntax highlighting: green for additions, red for deletions
- Uses monospace font, `text-xs`, `overflow-x-auto` for wide lines
- Shows file header: `+N -M` stats per file
- Accepts: `{ diffContent: string }` 

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitLog.tsx`**
- Lists recent commits in a scrollable list
- Each row: short SHA (mono), message, author, relative date (e.g. "2 hours ago")
- Click a row to open commit detail
- Selected row highlighted
- Keyboard: `↑/↓` to navigate, `Enter` to open, `Escape` to close detail
- Accepts: `{ commits: GitCommit[]; onSelectCommit: (sha: string) => void; selectedSha: string | null }`

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceCommitDetail.tsx`**
- Shows full diff for a selected commit
- Header: SHA, author, date, message
- Back button (or `Escape`) to return to log
- Renders same unified diff format as WorkspaceDiffViewer
- Shows loading state while daemon processes the request
- Accepts: `{ machineId: string; workingDir: string; sha: string; onClose: () => void }`

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitPanel.tsx`**

Container component — ties all hooks + views together:

```typescript
// State:
// - activeTab: 'branch' | 'diff' | 'log'
// - selectedCommitSha: string | null

// Props:
// - machineId: string
// - workingDir: string

// Renders:
// - Tab bar: "Branch" | "Diff" | "History"
// - Content pane based on activeTab:
//   - branch: WorkspaceGitBranch
//   - diff:   WorkspaceDiffViewer
//   - log:    WorkspaceGitLog (when commit selected, renders WorkspaceCommitDetail)

// Keyboard shortcuts (within panel focus):
// - g b → switch to Branch tab
// - g d → switch to Diff tab
// - g l → switch to History/Log tab
// - Escape → close commit detail (return to log)
// - ↑/↓ → navigate log when log tab active
// - Enter → open selected commit
```

---

## 6. Integration Point

### Location: Inside `WorkspaceAgentList.tsx`, below workspace header

The git panel is added as a new **collapsible section** inside `WorkspaceAgentList.tsx`, between the workspace header (folder + machine + agent count) and the agents list.

```
WorkspaceAgentList
├── Workspace header (existing)
│   ├── Folder icon + name + path
│   └── Machine + agent count metadata
├── [NEW] WorkspaceGitPanel  ← inserted here
│   ├── Tab bar: Branch | Diff | History
│   └── Content pane
├── "AGENTS" section label (existing)
└── Agent cards (existing, scrollable)
```

**Why here (not as a separate modal or new tab in the outer modal)?**
- The workspace panel in `UnifiedAgentListModal` is already the right context (user selected a workspace)
- The git data is scoped to `machineId + workingDir` — exactly what a workspace represents
- Avoids creating a new entry point or navigation layer

**Collapse behavior:** The `WorkspaceGitPanel` is collapsible via a toggle button (chevron). Default: collapsed. The layout remains compact when not needed.

---

## 7. File List

### Backend — Schema & Mutations

| File | Change |
|------|--------|
| `services/backend/convex/schema.ts` | Add `chatroom_workspaceGitState`, `chatroom_workspaceCommitDetail`, `chatroom_workspaceCommitRequests` tables |
| `services/backend/convex/workspaces.ts` | **NEW** — mutations: `upsertWorkspaceGitState`, `upsertCommitDetail`, `requestCommitDetail`; queries: `getWorkspaceGitState`, `getCommitDetail`, `getWorkspaceCommitRequests` |

### CLI/Daemon

| File | Change |
|------|--------|
| `packages/cli/src/infrastructure/git/git-reader.ts` | **NEW** — git command wrappers (branch, status, diff, log, show) |
| `packages/cli/src/infrastructure/git/push-git-state.ts` | **NEW** — collects workingDirs, runs git, calls upsertWorkspaceGitState |
| `packages/cli/src/infrastructure/git/process-commit-requests.ts` | **NEW** — polls pending commit requests, runs `git show`, calls upsertCommitDetail |
| `packages/cli/src/commands/machine/daemon-start/command-loop.ts` | **MODIFY** — add `pushGitStateForAllWorkspaces` and `processCommitDetailRequests` to heartbeat timer |

### Frontend — Hooks

| File | Change |
|------|--------|
| `apps/webapp/src/modules/chatroom/hooks/useWorkspaceGit.ts` | **NEW** — `useWorkspaceGit`, `useWorkspaceCommitDetail` hooks |

### Frontend — Components

| File | Change |
|------|--------|
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitBranch.tsx` | **NEW** — branch + dirty indicator + diff stat summary |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceDiffViewer.tsx` | **NEW** — unified diff renderer (collapsible per-file sections) |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitLog.tsx` | **NEW** — commit list with keyboard navigation |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceCommitDetail.tsx` | **NEW** — per-commit diff viewer with loading state |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitPanel.tsx` | **NEW** — container with tab bar, keyboard shortcuts, collapse toggle |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceAgentList.tsx` | **MODIFY** — add `WorkspaceGitPanel` between header and agents section; pass `machineId` prop |
| `apps/webapp/src/modules/chatroom/types/workspace.ts` | **MODIFY** — add `machineId: string` field to `Workspace` interface (currently `null`, needs to be the real machineId from backend workspaces) |

### Backend — Supporting Types

| File | Change |
|------|--------|
| `services/backend/src/domain/usecase/chatroom/get-agent-statuses.ts` | **MODIFY** — ensure `WorkspaceView` exposes `machineId` (currently may be omitted) |

---

## 8. Implementation Phases

### Phase 1: Backend Schema + Daemon Push (No UI yet)

**Goal:** Daemon pushes git state to Convex on every heartbeat. Can be verified via Convex dashboard.

1. Add `chatroom_workspaceGitState` table to `schema.ts`
2. Create `services/backend/convex/workspaces.ts` with `upsertWorkspaceGitState` mutation and `getWorkspaceGitState` query
3. Create `packages/cli/src/infrastructure/git/git-reader.ts`
4. Create `packages/cli/src/infrastructure/git/push-git-state.ts`
5. Modify `command-loop.ts` to call `pushGitStateForAllWorkspaces` in heartbeat

**Acceptance:** Running `chatroom machine start` and waiting 30s shows a `chatroom_workspaceGitState` row in the Convex dashboard with real git data.

---

### Phase 2: Frontend Git State Display (Branch + Diff)

**Goal:** Users can see branch and diff in the workspace panel.

1. Create `useWorkspaceGit.ts` hook
2. Ensure `WorkspaceView` in backend exposes `machineId` — patch `get-agent-statuses.ts` and `workspace.ts` type
3. Create `WorkspaceGitBranch.tsx`
4. Create `WorkspaceDiffViewer.tsx` (unified diff parser + renderer)
5. Create `WorkspaceGitPanel.tsx` with tabs (branch + diff only, log tab disabled)
6. Modify `WorkspaceAgentList.tsx` to render `WorkspaceGitPanel` (collapsible)

**Acceptance:** Opening the All Agents modal shows branch name, dirty indicator, and file diff when a workspace is selected and daemon is running.

---

### Phase 3: Git History (Log List)

**Goal:** Users can browse recent commits.

1. Create `WorkspaceGitLog.tsx` with keyboard navigation (`↑/↓`, `Enter`)
2. Enable the "History" tab in `WorkspaceGitPanel.tsx`
3. Add keyboard shortcuts (`g l`, `g b`, `g d`) to `WorkspaceGitPanel.tsx`

**Acceptance:** Switching to History tab shows 20 recent commits with SHA, message, author, date.

---

### Phase 4: Commit Detail (On-Demand)

**Goal:** Click a commit to see its full diff.

1. Add `chatroom_workspaceCommitDetail` and `chatroom_workspaceCommitRequests` tables to `schema.ts`
2. Add `requestCommitDetail`, `upsertCommitDetail`, `getCommitDetail`, `getWorkspaceCommitRequests` to `workspaces.ts`
3. Create `packages/cli/src/infrastructure/git/process-commit-requests.ts`
4. Modify `command-loop.ts` to call `processCommitDetailRequests` in heartbeat
5. Create `WorkspaceCommitDetail.tsx` (with loading state while daemon processes request)
6. Wire commit selection in `WorkspaceGitPanel.tsx`: clicking a commit calls `requestCommitDetail`, then subscribes to `getCommitDetail` for the result

**Acceptance:** Clicking a commit shows its diff within ~30s (one heartbeat cycle). Subsequent opens are instant (cached in `chatroom_workspaceCommitDetail`).

---

### Phase 5: Polish + Edge Cases

1. Cap `diffContent` at 500KB in `push-git-state.ts` to avoid Convex limits; show truncation notice in UI
2. Handle non-git directories gracefully (no error, just skip; show "Not a git repo" in panel)
3. Handle detached HEAD state (`git rev-parse` returns "HEAD" — display as "detached HEAD @ <sha>")
4. Dark mode audit for all new components (use semantic colors)
5. Empty state: "No changes" when `diffContent` is empty; "No commits" when `recentCommits` is empty
6. Handle daemon offline: show stale timestamp ("Last updated 5 min ago") using `updatedAt`

---

## Appendix: Key Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data push model | Heartbeat (30s push) | Simpler, consistent with existing patterns |
| Commit detail fetch | On-demand via request table | Avoids storing 20× full diffs per workspace |
| Diff size cap | 500KB | Convex document size limit (~1MB), leave headroom |
| UI integration point | Inside WorkspaceAgentList (collapsible) | Right context, no new navigation layer |
| Tab UX | Tab bar with keyboard shortcuts | Familiar pattern; `g b/d/l` mnemonics |
| Per-file diff parsing | Client-side (split on `diff --git`) | Server returns raw unified diff; no extra complexity |
| workingDir tracking | Query teamAgentConfigs on heartbeat | Simplest; avoids extra state in DaemonContext |
