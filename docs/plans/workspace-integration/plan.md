# Workspace Integration Plan

## Overview

Each chatroom may reside in one or more workspaces (determined by the `workingDir` of agents). This plan covers three features:

1. **Diff Reporting** — high-level overall diff + per-file code review for current changes
2. **Current Branch Reporting** — show what branch we are currently on in the workspace
3. **Git History** — view git log for current branch, click commits to see file diffs

---

## Key Decisions (User-Approved)

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| 1 | Push frequency | Change-detection: skip if unchanged | Only push when git state changes (compare branch + diff hash) |
| 2 | Diff storage | diffStat only; full diff on-demand | Lighter writes, fetch full diff when user requests |
| 3 | Git log depth | 20 commits + "load more" | Start with 20, allow pagination for more |
| 4 | Commit detail latency | Fast on-demand pipeline | NOT heartbeat-gated; process requests immediately via fast polling loop |
| 5 | Data scope | machineId + workingDir | All chatrooms sharing machine+workingDir see same git data |
| 6 | Diff type | `git diff HEAD` | Show all uncommitted changes (staged + unstaged) |
| 7 | Non-git dirs | Show workspace, display "Git info not found" | Use union types for proper state encoding (not null/undefined) |

---

## 1. Architecture Decision

### Hybrid Model: Change-Detection Push + On-Demand Details

**Decision: Daemon checks for git state changes on heartbeat (every 30s), pushes only if changed. Full diff content and commit details are fetched on-demand via a fast pipeline (~5s response).**

#### Data Flow (State Summary — Heartbeat)

```
Daemon (heartbeat, every 30s)
  → runs git commands (branch, status, diff HEAD --stat)
  → compares with last pushed state (branch + isDirty + diffStat hash)
  → IF CHANGED: calls mutation: workspaces.upsertWorkspaceGitState
  → IF UNCHANGED: skips (no write)
  → Convex stores chatroom_workspaceGitState table

Frontend
  → useSessionQuery(api.workspaces.getWorkspaceGitState, { machineId, workingDir })
  → Convex real-time subscription (live updates on upsert)
  → WorkspaceGitPanel renders branch / diffStat / history summary
```

#### Data Flow (On-Demand Full Diff)

```
User clicks "View Diff" in UI
  → Frontend calls mutation: workspaces.requestFullDiff({ machineId, workingDir })
  → Inserts pending row in chatroom_workspaceDiffRequests

Daemon (fast polling loop, every 5s)
  → Queries pending diff requests for this machine
  → Runs git diff HEAD (up to 500KB cap)
  → Calls mutation: workspaces.upsertFullDiff({ machineId, workingDir, content })
  → Marks request as done

Frontend
  → useSessionQuery(api.workspaces.getFullDiff, { machineId, workingDir })
  → Renders full diff when available (~5s latency)
```

#### Data Flow (On-Demand Commit Detail)

Same pattern as full diff — user clicks a commit, request inserted, daemon processes on fast polling loop (~5s), result pushed to separate table.

#### Data Flow (Load More Commits)

```
User clicks "Load More" in git log
  → Frontend calls mutation: workspaces.requestMoreCommits({ machineId, workingDir, offset: 20 })
  → Daemon processes on fast loop, runs: git log -20 --skip=20 ...
  → Appends to recentCommits in chatroom_workspaceGitState
```

#### Key Design Points

- Git state is keyed by `machineId + workingDir` — workspace-level, not chatroom-level
- All chatrooms sharing the same machine+workingDir see the same git data (correct behavior)
- **State types use discriminated unions** — `GitStateAvailable | GitStateNotFound | GitStateLoading` — no null/undefined for optional states
- Heartbeat push is **change-detected**: daemon tracks last pushed state, only writes when different
- Full diff content (`git diff HEAD`) is **on-demand only** — not stored in heartbeat push
- Commit detail (`git show <sha>`) is also **on-demand only**
- Recent commits start at 20, user can request more via "load more" (pagination)
- Non-git directories are explicitly represented with `status: 'not_found'` state

---

## 2. Backend Schema Changes

### Type Strategy: Discriminated Unions

All git state uses discriminated unions for proper state encoding:

```typescript
// GitState discriminated union
type GitState =
  | { status: 'available'; branch: string; isDirty: boolean; diffStat: DiffStat; recentCommits: Commit[]; updatedAt: number }
  | { status: 'not_found' }  // Not a git repository
  | { status: 'loading' }    // Initial state, daemon hasn't pushed yet
```

### New Table: `chatroom_workspaceGitState`

```typescript
chatroom_workspaceGitState: defineTable({
  // Identity: unique workspace
  machineId: v.string(),
  workingDir: v.string(),

  // Discriminated union status
  status: v.union(
    v.literal('available'),
    v.literal('not_found'),
    v.literal('error')
  ),

  // Branch info (only when status === 'available')
  branch: v.optional(v.string()),           // e.g. "main", "feat/my-feature", "HEAD" (detached)
  isDirty: v.optional(v.boolean()),         // true if working tree has uncommitted changes

  // Diff summary: git diff HEAD --stat (only when status === 'available')
  diffStat: v.optional(v.object({
    filesChanged: v.number(),
    insertions: v.number(),
    deletions: v.number(),
  })),

  // NOTE: Full diff content is NOT stored here — fetch on-demand via requestFullDiff

  // Recent commits: git log -20 --format=... (only when status === 'available')
  // Paginated: daemon appends more when user requests "load more"
  recentCommits: v.optional(v.array(v.object({
    sha: v.string(),             // full SHA
    shortSha: v.string(),        // 7-char short SHA
    message: v.string(),         // commit message (first line)
    author: v.string(),          // author name
    date: v.string(),            // ISO 8601 date string
  }))),

  // Total commit count (for "load more" logic)
  totalCommitCount: v.optional(v.number()),
  hasMoreCommits: v.optional(v.boolean()),

  // Error message (only when status === 'error')
  errorMessage: v.optional(v.string()),

  // Last time git state was pushed by the daemon
  updatedAt: v.number(),
})
  .index('by_machine_workingDir', ['machineId', 'workingDir'])
```

### New Table: `chatroom_workspaceFullDiff`

```typescript
chatroom_workspaceFullDiff: defineTable({
  machineId: v.string(),
  workingDir: v.string(),

  // git diff HEAD output (up to 500KB cap)
  diffContent: v.string(),      // raw unified diff string
  truncated: v.boolean(),       // true if diff was capped at 500KB

  // Stats derived from the diff
  filesChanged: v.number(),
  insertions: v.number(),
  deletions: v.number(),

  updatedAt: v.number(),
})
  .index('by_machine_workingDir', ['machineId', 'workingDir'])
```

### New Table: `chatroom_workspaceDiffRequests`

```typescript
chatroom_workspaceDiffRequests: defineTable({
  machineId: v.string(),
  workingDir: v.string(),
  requestType: v.union(
    v.literal('full_diff'),
    v.literal('commit_detail'),
    v.literal('more_commits')
  ),
  // For commit_detail requests
  sha: v.optional(v.string()),
  // For more_commits requests
  offset: v.optional(v.number()),
  status: v.union(v.literal('pending'), v.literal('processing'), v.literal('done'), v.literal('error')),
  requestedAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_machine_status', ['machineId', 'status'])
  .index('by_machine_workingDir_type', ['machineId', 'workingDir', 'requestType'])
```

### New Table: `chatroom_workspaceCommitDetail`

```typescript
chatroom_workspaceCommitDetail: defineTable({
  machineId: v.string(),
  workingDir: v.string(),
  sha: v.string(),              // full commit SHA

  // git show <sha> output (stat + full patch)
  diffContent: v.string(),      // raw unified diff string
  truncated: v.boolean(),       // true if diff was capped

  // Commit metadata
  message: v.string(),
  author: v.string(),
  date: v.string(),

  // Derived stats from the commit
  filesChanged: v.number(),
  insertions: v.number(),
  deletions: v.number(),

  updatedAt: v.number(),
})
  .index('by_machine_workingDir_sha', ['machineId', 'workingDir', 'sha'])
```

---

## 3. Backend Mutations/Queries

### New file: `services/backend/convex/workspaces.ts`

```typescript
// === Mutations (called by daemon) ===

export const upsertWorkspaceGitState = mutation(...)
// - Args: SessionIdArg, machineId, workingDir, status, branch?, isDirty?, diffStat?, recentCommits?, hasMoreCommits?, errorMessage?
// - Upserts chatroom_workspaceGitState by machineId + workingDir
// - Auth: validates machine ownership

export const upsertFullDiff = mutation(...)
// - Args: SessionIdArg, machineId, workingDir, diffContent, truncated, filesChanged, insertions, deletions
// - Upserts chatroom_workspaceFullDiff
// - Called by daemon when processing a full_diff request

export const upsertCommitDetail = mutation(...)
// - Args: SessionIdArg, machineId, workingDir, sha, diffContent, truncated, message, author, date, filesChanged, insertions, deletions
// - Upserts chatroom_workspaceCommitDetail
// - Called by daemon when processing a commit_detail request

export const appendMoreCommits = mutation(...)
// - Args: SessionIdArg, machineId, workingDir, commits[], hasMoreCommits
// - Appends commits to recentCommits in chatroom_workspaceGitState
// - Called by daemon when processing a more_commits request

export const updateRequestStatus = mutation(...)
// - Args: SessionIdArg, requestId, status
// - Updates status field of a request row

// === Mutations (called by frontend) ===

export const requestFullDiff = mutation(...)
// - Args: SessionIdArg, machineId, workingDir
// - Inserts a pending chatroom_workspaceDiffRequests row with requestType='full_diff'
// - Idempotent: if pending request exists, return existing

export const requestCommitDetail = mutation(...)
// - Args: SessionIdArg, machineId, workingDir, sha
// - Inserts a pending chatroom_workspaceDiffRequests row with requestType='commit_detail'

export const requestMoreCommits = mutation(...)
// - Args: SessionIdArg, machineId, workingDir, offset
// - Inserts a pending chatroom_workspaceDiffRequests row with requestType='more_commits'

// === Queries (called by frontend) ===

export const getWorkspaceGitState = query(...)
// - Args: SessionIdArg, machineId, workingDir
// - Returns chatroom_workspaceGitState row or { status: 'loading' }

export const getFullDiff = query(...)
// - Args: SessionIdArg, machineId, workingDir
// - Returns chatroom_workspaceFullDiff row or null

export const getCommitDetail = query(...)
// - Args: SessionIdArg, machineId, workingDir, sha
// - Returns chatroom_workspaceCommitDetail row or null

// === Queries (called by daemon) ===

export const getPendingRequests = query(...)
// - Args: SessionIdArg, machineId
// - Returns all pending chatroom_workspaceDiffRequests rows for this machine
```

---

## 4. CLI/Daemon Changes

### Fast Polling Loop for On-Demand Requests

In addition to the 30s heartbeat, add a **5s fast polling loop** for processing on-demand requests:

```typescript
// In command-loop.ts

// Existing heartbeat (30s) — change-detection push
const heartbeatTimer = setInterval(() => {
  ctx.deps.backend.mutation(api.machines.daemonHeartbeat, {...})
  pushGitStateSummaryIfChanged(ctx).catch(...)  // Only pushes if state changed
}, DAEMON_HEARTBEAT_INTERVAL_MS); // 30s

// New fast loop (5s) — on-demand request processing
const requestProcessorTimer = setInterval(() => {
  processGitRequests(ctx).catch(...)  // Full diff, commit detail, more commits
}, GIT_REQUEST_POLL_INTERVAL_MS); // 5s
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

export type GitReadResult =
  | { status: 'available'; data: GitStateData }
  | { status: 'not_found' }
  | { status: 'error'; message: string };

// Git commands to run:
// git rev-parse --is-inside-work-tree    → check if git repo (returns 'true' or error)
// git rev-parse --abbrev-ref HEAD        → branch name
// git status --porcelain                 → isDirty (non-empty = dirty)
// git diff HEAD --stat                   → diff stat (insertions/deletions/files)
// git diff HEAD                          → full diff content (cap at 500KB)
// git log -20 --format="%H|%h|%s|%an|%aI" → recent commits
// git rev-list --count HEAD              → total commit count (for hasMoreCommits)
// git log -20 --skip=N --format=...      → more commits (pagination)
// git show <sha> --format="%s|%an|%aI" --stat -p    → commit detail
```

### New file: `packages/cli/src/infrastructure/git/push-git-state.ts`

```typescript
// pushGitStateSummaryIfChanged(ctx)
// 1. Collect all active workingDirs from ctx (tracked via agent configs)
// 2. For each workingDir:
//    a. Check if git repo (git rev-parse --is-inside-work-tree)
//    b. If not git repo: push { status: 'not_found' }
//    c. If git repo: run git commands via git-reader
//    d. Compare with last pushed state (stored in memory)
//    e. If changed: call api.workspaces.upsertWorkspaceGitState
//    f. If unchanged: skip
// 3. Track last state in DaemonContext for change detection
```

### New file: `packages/cli/src/infrastructure/git/process-git-requests.ts`

```typescript
// processGitRequests(ctx)
// 1. Query api.workspaces.getPendingRequests for this machineId
// 2. For each pending request:
//    a. Mark as 'processing' via updateRequestStatus
//    b. Based on requestType:
//       - full_diff: run `git diff HEAD`, call upsertFullDiff
//       - commit_detail: run `git show <sha>`, call upsertCommitDetail
//       - more_commits: run `git log -20 --skip=N`, call appendMoreCommits
//    c. Mark as 'done' via updateRequestStatus
// 3. Cap diff content at 500KB, set truncated=true if capped
```

### Modified file: `packages/cli/src/commands/machine/daemon-start/command-loop.ts`

- Add fast polling timer (5s) for request processing
- Import and call `pushGitStateSummaryIfChanged` in heartbeat (change-detected)
- Import and call `processGitRequests` in fast loop
- Add cleanup for both timers on shutdown

### DaemonContext Changes

Add state tracking for change detection:

```typescript
interface DaemonContext {
  // ... existing fields
  lastPushedGitState: Map<string, GitStateSummary>; // workingDir -> summary hash
}
```

---

## 5. Frontend Layers

### Type Definitions

**New file: `apps/webapp/src/modules/chatroom/types/git.ts`**

```typescript
// Discriminated union types for git state
export type WorkspaceGitState =
  | { status: 'loading' }
  | { status: 'not_found' }
  | { status: 'error'; message: string }
  | {
      status: 'available';
      branch: string;
      isDirty: boolean;
      diffStat: { filesChanged: number; insertions: number; deletions: number };
      recentCommits: GitCommit[];
      hasMoreCommits: boolean;
      updatedAt: number;
    };

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export type FullDiffState =
  | { status: 'idle' }           // Not requested yet
  | { status: 'loading' }        // Request pending
  | { status: 'available'; content: string; truncated: boolean; stats: DiffStat }
  | { status: 'error'; message: string };

export type CommitDetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'available'; content: string; truncated: boolean; message: string; author: string; date: string; stats: DiffStat }
  | { status: 'error'; message: string };
```

### Hooks Layer

**New file: `apps/webapp/src/modules/chatroom/hooks/useWorkspaceGit.ts`**

```typescript
// useWorkspaceGit(machineId: string, workingDir: string): WorkspaceGitState
// - Calls useSessionQuery(api.workspaces.getWorkspaceGitState, { machineId, workingDir })
// - Transforms backend response to WorkspaceGitState discriminated union
// - Returns { status: 'loading' } while query is undefined

// useFullDiff(machineId: string, workingDir: string): { state: FullDiffState; request: () => void }
// - state: from useSessionQuery(api.workspaces.getFullDiff)
// - request: calls useSessionMutation(api.workspaces.requestFullDiff)

// useCommitDetail(machineId: string, workingDir: string, sha: string | null): { state: CommitDetailState; request: (sha: string) => void }
// - Similar pattern to useFullDiff

// useLoadMoreCommits(machineId: string, workingDir: string): { loading: boolean; loadMore: () => void }
// - Tracks loading state
// - loadMore: calls requestMoreCommits with current offset
```

### View Components

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitBranch.tsx`**

```typescript
// Props: { state: WorkspaceGitState }
// Renders based on state.status:
// - 'loading': Skeleton/spinner
// - 'not_found': "Git info not found" message with icon
// - 'error': Error message
// - 'available': Branch name + dirty indicator + diff stat summary
//   - GitBranch icon (lucide-react)
//   - Branch name (mono font)
//   - Yellow dot if isDirty
//   - "3 files, +45 -12" in muted text
```

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceDiffViewer.tsx`**

```typescript
// Props: { state: FullDiffState; onRequest: () => void }
// Renders based on state.status:
// - 'idle': "Click to load diff" button
// - 'loading': Skeleton/spinner
// - 'error': Error message
// - 'available': Full unified diff with:
//   - Truncation warning if state.truncated
//   - Per-file collapsible sections (parse on `diff --git`)
//   - Syntax highlighting (green additions, red deletions)
//   - Monospace font, text-xs, overflow-x-auto
//   - File header with +N -M stats
```

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitLog.tsx`**

```typescript
// Props: { commits: GitCommit[]; hasMore: boolean; onSelectCommit: (sha: string) => void; onLoadMore: () => void; selectedSha: string | null; loadingMore: boolean }
// - Scrollable list of commits
// - Each row: short SHA (mono), message, author, relative date
// - Selected row highlighted
// - "Load more" button at bottom if hasMore
// - Keyboard: ↑/↓ to navigate, Enter to select
```

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceCommitDetail.tsx`**

```typescript
// Props: { machineId: string; workingDir: string; sha: string; onClose: () => void }
// - Header: SHA, author, date, commit message
// - Back button or Escape to close
// - Uses useCommitDetail hook
// - Renders based on state.status:
//   - 'idle' / 'loading': Loading state with spinner
//   - 'available': Full diff (same renderer as WorkspaceDiffViewer)
//   - 'error': Error message
```

**New file: `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitPanel.tsx`**

Container component:

```typescript
// Props: { machineId: string; workingDir: string }
// State:
// - activeTab: 'branch' | 'diff' | 'log'
// - selectedCommitSha: string | null (when viewing commit detail)

// Uses hooks:
// - useWorkspaceGit(machineId, workingDir)
// - useFullDiff(machineId, workingDir)
// - useCommitDetail(machineId, workingDir, selectedCommitSha)
// - useLoadMoreCommits(machineId, workingDir)

// Renders:
// - If state.status === 'not_found': Just shows "Git info not found"
// - Otherwise: Tab bar + content pane

// Tab bar: "Branch" | "Diff" | "History"
// Content pane:
// - branch tab: WorkspaceGitBranch
// - diff tab: WorkspaceDiffViewer
// - log tab: WorkspaceGitLog (or WorkspaceCommitDetail when commit selected)

// Keyboard shortcuts (register when panel focused):
// - g b → switch to Branch tab
// - g d → switch to Diff tab
// - g l → switch to History/Log tab
// - Escape → close commit detail (return to log)
// - ↑/↓ → navigate log when log tab active
// - Enter → open selected commit

// Collapsible: controlled by parent
```

---

## 6. Integration Point

### Location: Inside `WorkspaceAgentList.tsx`, below workspace header

The git panel is added as a new **collapsible section** inside `WorkspaceAgentList.tsx`, between the workspace header and the agents list.

```
WorkspaceAgentList
├── Workspace header (existing)
│   ├── Folder icon + name + path
│   └── Machine + agent count metadata
├── [NEW] WorkspaceGitPanel (collapsible, default: collapsed)
│   ├── Collapse toggle (chevron)
│   ├── Tab bar: Branch | Diff | History (when expanded)
│   └── Content pane
├── "AGENTS" section label (existing)
└── Agent cards (existing, scrollable)
```

**Non-git directories:** Workspace icon still shows. When user clicks in, `WorkspaceGitPanel` displays "Git info not found" message (from the `not_found` state). No error, clean UX.

**Why here (not as a separate modal)?**
- The workspace panel is already the right context (user selected a workspace)
- Git data is scoped to `machineId + workingDir` — exactly what a workspace represents
- Avoids creating a new navigation layer

---

## 7. File List

### Backend — Schema & Mutations

| File | Change |
|------|--------|
| `services/backend/convex/schema.ts` | Add `chatroom_workspaceGitState`, `chatroom_workspaceFullDiff`, `chatroom_workspaceCommitDetail`, `chatroom_workspaceDiffRequests` tables |
| `services/backend/convex/workspaces.ts` | **NEW** — all mutations and queries listed in section 3 |

### CLI/Daemon

| File | Change |
|------|--------|
| `packages/cli/src/infrastructure/git/git-reader.ts` | **NEW** — git command wrappers with union return types |
| `packages/cli/src/infrastructure/git/push-git-state.ts` | **NEW** — change-detection push on heartbeat |
| `packages/cli/src/infrastructure/git/process-git-requests.ts` | **NEW** — fast loop request processor |
| `packages/cli/src/commands/machine/daemon-start/command-loop.ts` | **MODIFY** — add fast polling timer, call git functions |
| `packages/cli/src/commands/machine/daemon-start/types.ts` | **MODIFY** — add `lastPushedGitState` to DaemonContext |

### Frontend — Types

| File | Change |
|------|--------|
| `apps/webapp/src/modules/chatroom/types/git.ts` | **NEW** — discriminated union types for git state |

### Frontend — Hooks

| File | Change |
|------|--------|
| `apps/webapp/src/modules/chatroom/hooks/useWorkspaceGit.ts` | **NEW** — all git-related hooks |

### Frontend — Components

| File | Change |
|------|--------|
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitBranch.tsx` | **NEW** — branch + dirty indicator + diff stat |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceDiffViewer.tsx` | **NEW** — full diff renderer |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitLog.tsx` | **NEW** — commit list with load more |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceCommitDetail.tsx` | **NEW** — per-commit diff viewer |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitPanel.tsx` | **NEW** — container with tabs + keyboard |
| `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceAgentList.tsx` | **MODIFY** — add collapsible WorkspaceGitPanel |

### Backend — Supporting Changes

| File | Change |
|------|--------|
| `services/backend/src/domain/usecase/chatroom/get-agent-statuses.ts` | **MODIFY** — ensure `WorkspaceView` exposes `machineId` |

---

## 8. Implementation Phases

### Phase 1: Backend Schema + Daemon Push (Change-Detection)

**Goal:** Daemon pushes git state summary (branch, diffStat, commits) to Convex on heartbeat, only when changed. Non-git directories are explicitly marked.

1. Add all 4 tables to `schema.ts`
2. Create `services/backend/convex/workspaces.ts` with:
   - `upsertWorkspaceGitState` mutation
   - `getWorkspaceGitState` query
3. Create `packages/cli/src/infrastructure/git/git-reader.ts`
4. Create `packages/cli/src/infrastructure/git/push-git-state.ts` (with change detection)
5. Modify `command-loop.ts` to call `pushGitStateSummaryIfChanged` in heartbeat
6. Modify `DaemonContext` to track `lastPushedGitState`

**Acceptance:** 
- Running `chatroom machine start` in a git repo shows a `chatroom_workspaceGitState` row with `status: 'available'`
- Running in a non-git dir shows `status: 'not_found'`
- Repeated heartbeats don't create new writes if state unchanged

---

### Phase 2: Frontend Git State Display (Branch + DiffStat)

**Goal:** Users see branch info and diff summary in the workspace panel.

1. Create `types/git.ts` with discriminated unions
2. Create `useWorkspaceGit.ts` hook
3. Ensure `WorkspaceView` exposes `machineId` — patch `get-agent-statuses.ts`
4. Create `WorkspaceGitBranch.tsx`
5. Create `WorkspaceGitPanel.tsx` (tabs: Branch only for now)
6. Modify `WorkspaceAgentList.tsx` to render `WorkspaceGitPanel`

**Acceptance:**
- Opening All Agents modal → selecting workspace shows branch name + dirty indicator
- Non-git workspace shows "Git info not found" message

---

### Phase 3: On-Demand Full Diff

**Goal:** Users can request and view full diff content.

1. Add `requestFullDiff`, `upsertFullDiff`, `getFullDiff` to `workspaces.ts`
2. Create fast polling loop (5s) in `command-loop.ts`
3. Create `packages/cli/src/infrastructure/git/process-git-requests.ts`
4. Create `useFullDiff` hook
5. Create `WorkspaceDiffViewer.tsx`
6. Enable Diff tab in `WorkspaceGitPanel.tsx`

**Acceptance:**
- Clicking Diff tab shows "Load Diff" button
- Clicking button triggers request, diff appears within ~5s
- Large diffs show truncation warning

---

### Phase 4: Git History + Load More

**Goal:** Users can browse commits with pagination.

1. Add `requestMoreCommits`, `appendMoreCommits` to `workspaces.ts`
2. Add more_commits handling to `process-git-requests.ts`
3. Create `useLoadMoreCommits` hook
4. Create `WorkspaceGitLog.tsx` with keyboard navigation
5. Enable History tab in `WorkspaceGitPanel.tsx`
6. Add keyboard shortcuts (`g b/d/l`, `↑/↓`, `Enter`)

**Acceptance:**
- History tab shows 20 commits
- "Load More" button loads next 20
- Keyboard navigation works

---

### Phase 5: Commit Detail (On-Demand)

**Goal:** Click a commit to see its full diff.

1. Add `requestCommitDetail`, `upsertCommitDetail`, `getCommitDetail` to `workspaces.ts`
2. Add commit_detail handling to `process-git-requests.ts`
3. Create `useCommitDetail` hook
4. Create `WorkspaceCommitDetail.tsx`
5. Wire commit selection in `WorkspaceGitLog.tsx`

**Acceptance:**
- Clicking a commit shows loading state
- Diff appears within ~5s
- Back/Escape returns to log

---

### Phase 6: Polish + Edge Cases

1. Dark mode audit for all new components
2. Handle detached HEAD (`git rev-parse` returns "HEAD" → display "detached @ <sha>")
3. Empty states: "No changes" when clean, "No commits" when empty
4. Stale timestamp display ("Last updated 5 min ago") using `updatedAt`
5. Error state styling and retry affordance
6. Performance: debounce keyboard navigation, virtualize long commit lists

---

## Appendix: Git Commands Reference

| Purpose | Command | Notes |
|---------|---------|-------|
| Check if git repo | `git rev-parse --is-inside-work-tree` | Returns 'true' or error |
| Get branch | `git rev-parse --abbrev-ref HEAD` | Returns 'HEAD' if detached |
| Check dirty | `git status --porcelain` | Non-empty = dirty |
| Diff stat | `git diff HEAD --stat` | All uncommitted changes |
| Full diff | `git diff HEAD` | Cap at 500KB |
| Recent commits | `git log -20 --format="%H\|%h\|%s\|%an\|%aI"` | Pipe-delimited |
| Total commits | `git rev-list --count HEAD` | For hasMoreCommits |
| More commits | `git log -20 --skip=N --format=...` | Pagination |
| Commit detail | `git show <sha> --format="%s\|%an\|%aI" -p` | Full patch |
