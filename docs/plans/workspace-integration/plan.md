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

> **Review Checkpoints:** This plan includes explicit pause points for user validation before proceeding. This ensures the foundational architecture is correct before building on top of it.

---

### Phase 1: CLI Infrastructure — Real-Time Command Receiving

**Goal:** Build the daemon infrastructure to support real-time receiving of on-demand commands (for git requests). This establishes the fast polling loop pattern.

**Files:**
1. `packages/cli/src/infrastructure/git/git-reader.ts` — **NEW**
   - Git command wrappers with discriminated union return types
   - Functions: `isGitRepo()`, `getBranch()`, `isDirty()`, `getDiffStat()`, `getFullDiff()`, `getRecentCommits()`, `getCommitDetail()`
   - All functions return `Result<T, GitError>` or similar union type
   
2. `packages/cli/src/infrastructure/git/types.ts` — **NEW**
   - Type definitions: `GitBranchInfo`, `GitDiffStat`, `GitCommit`, `GitReadResult`
   - Discriminated unions: `GitStateAvailable | GitStateNotFound | GitStateError`

3. `packages/cli/src/commands/machine/daemon-start/git-polling.ts` — **NEW**
   - Fast polling loop infrastructure (5s interval)
   - Pattern: poll for pending requests → process → push results
   - For now: just the loop skeleton, no actual request processing yet

4. `packages/cli/src/commands/machine/daemon-start/command-loop.ts` — **MODIFY**
   - Add fast polling timer (5s) alongside heartbeat timer (30s)
   - Import and start `gitPollingLoop` on daemon start
   - Proper cleanup on shutdown

5. `packages/cli/src/commands/machine/daemon-start/types.ts` — **MODIFY**
   - Add `lastPushedGitState: Map<string, string>` to DaemonContext (for change detection)

**Acceptance:**
- Daemon starts with two timers: heartbeat (30s) + git polling (5s)
- `git-reader.ts` functions work standalone (manual testing via CLI)
- Git commands return proper discriminated union results
- Non-git directories return `{ status: 'not_found' }` cleanly

---

### Phase 2: Backend Domain Models + Use Cases

**Goal:** Define the backend domain layer — types, use cases, and Convex functions — without schema yet. Use in-memory or placeholder data.

**Files:**
1. `services/backend/src/domain/types/workspace-git.ts` — **NEW**
   - Domain types: `WorkspaceGitState`, `GitCommit`, `DiffStat`, `FullDiff`, `CommitDetail`
   - Request types: `DiffRequest`, `CommitDetailRequest`, `MoreCommitsRequest`
   - All using discriminated unions

2. `services/backend/src/domain/usecase/workspace/get-workspace-git-state.ts` — **NEW**
   - Use case: `getWorkspaceGitState(machineId, workingDir)`
   - For now: returns mock data (hardcoded git state)
   - Interface defined, implementation placeholder

3. `services/backend/src/domain/usecase/workspace/request-full-diff.ts` — **NEW**
   - Use case: `requestFullDiff(machineId, workingDir)`
   - For now: no-op or logs to console
   
4. `services/backend/src/domain/usecase/workspace/upsert-workspace-git-state.ts` — **NEW**
   - Use case: `upsertWorkspaceGitState(data)`
   - For now: logs or stores in memory (no DB)

5. `services/backend/convex/workspaces.ts` — **NEW**
   - Convex functions that wrap domain use cases
   - Queries: `getWorkspaceGitState` (returns mock data)
   - Mutations: `upsertWorkspaceGitState`, `requestFullDiff` (no-ops for now)
   - Auth: validate session + machine ownership pattern

**Acceptance:**
- Domain types are defined with proper discriminated unions
- Convex functions are callable (via dashboard or frontend)
- `getWorkspaceGitState` returns mock data with all fields
- Type exports work correctly for frontend consumption

---

### Phase 3: Frontend UI with Comprehensive Dummy Data

**Goal:** Build the full UI experience with hardcoded/mock data. All components, tabs, keyboard shortcuts, and states should work — just not connected to real backend yet.

**Files:**
1. `apps/webapp/src/modules/chatroom/types/git.ts` — **NEW**
   - Frontend type definitions (mirror of domain types)
   - `WorkspaceGitState`, `FullDiffState`, `CommitDetailState` discriminated unions

2. `apps/webapp/src/modules/chatroom/hooks/useWorkspaceGit.ts` — **NEW**
   - Hooks with mock data (not calling backend yet)
   - `useWorkspaceGit()` — returns hardcoded available state
   - `useFullDiff()` — returns hardcoded diff content
   - `useCommitDetail()` — returns hardcoded commit diff
   - `useLoadMoreCommits()` — simulates loading

3. `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitBranch.tsx` — **NEW**
   - Renders branch, dirty indicator, diff stat summary
   - Handles all states: loading, not_found, error, available

4. `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceDiffViewer.tsx` — **NEW**
   - Full unified diff renderer
   - Per-file collapsible sections
   - Syntax highlighting (additions green, deletions red)
   - Truncation warning
   - "Load Diff" button for idle state

5. `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitLog.tsx` — **NEW**
   - Commit list with keyboard navigation (↑/↓/Enter)
   - "Load More" button
   - Selected row highlighting

6. `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceCommitDetail.tsx` — **NEW**
   - Per-commit diff viewer
   - Header: SHA, author, date, message
   - Back button / Escape to close
   - Loading state

7. `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceGitPanel.tsx` — **NEW**
   - Container with tab bar (Branch | Diff | History)
   - Keyboard shortcuts (g b/d/l)
   - Collapsible toggle
   - Handles not_found state

8. `apps/webapp/src/modules/chatroom/components/AgentPanel/WorkspaceAgentList.tsx` — **MODIFY**
   - Add `WorkspaceGitPanel` between header and agents
   - Pass machineId and workingDir props

**Acceptance:**
- All UI components render correctly with mock data
- Tab switching works (Branch → Diff → History)
- Keyboard shortcuts work (g b/d/l, ↑/↓, Enter, Escape)
- All states visible: loading, available, not_found, error
- Diff viewer shows syntax-highlighted unified diff
- Git log shows commits with "Load More"
- Commit detail opens/closes properly
- Dark mode works for all components

---

## ⏸️ REVIEW CHECKPOINT 1

**Pause here for user review.**

At this point:
- CLI infrastructure is in place (git-reader, polling loop)
- Backend domain types and use cases are defined
- Frontend UI is fully built with mock data

**User validates:**
1. ✓ CLI git-reader works correctly (run manual tests)
2. ✓ Domain types are well-structured (discriminated unions)
3. ✓ UI looks and feels right (all states, tabs, keyboard)
4. ✓ UX flows make sense

**Proceed to Phase 4 only after user approval.**

---

### Phase 4: Database Schema

**Goal:** Add the Convex schema tables. No data flow yet — just the schema definition.

**Files:**
1. `services/backend/convex/schema.ts` — **MODIFY**
   - Add `chatroom_workspaceGitState` table
   - Add `chatroom_workspaceFullDiff` table
   - Add `chatroom_workspaceCommitDetail` table
   - Add `chatroom_workspaceDiffRequests` table
   - All with proper indexes

**Table Definitions:**

```typescript
// chatroom_workspaceGitState
{
  machineId: v.string(),
  workingDir: v.string(),
  status: v.union(v.literal('available'), v.literal('not_found'), v.literal('error')),
  branch: v.optional(v.string()),
  isDirty: v.optional(v.boolean()),
  diffStat: v.optional(v.object({ filesChanged, insertions, deletions })),
  recentCommits: v.optional(v.array(...)),
  hasMoreCommits: v.optional(v.boolean()),
  errorMessage: v.optional(v.string()),
  updatedAt: v.number(),
}
.index('by_machine_workingDir', ['machineId', 'workingDir'])

// chatroom_workspaceFullDiff
{
  machineId: v.string(),
  workingDir: v.string(),
  diffContent: v.string(),
  truncated: v.boolean(),
  filesChanged: v.number(),
  insertions: v.number(),
  deletions: v.number(),
  updatedAt: v.number(),
}
.index('by_machine_workingDir', ['machineId', 'workingDir'])

// chatroom_workspaceDiffRequests
{
  machineId: v.string(),
  workingDir: v.string(),
  requestType: v.union(v.literal('full_diff'), v.literal('commit_detail'), v.literal('more_commits')),
  sha: v.optional(v.string()),
  offset: v.optional(v.number()),
  status: v.union(v.literal('pending'), v.literal('processing'), v.literal('done'), v.literal('error')),
  requestedAt: v.number(),
  updatedAt: v.number(),
}
.index('by_machine_status', ['machineId', 'status'])

// chatroom_workspaceCommitDetail
{
  machineId: v.string(),
  workingDir: v.string(),
  sha: v.string(),
  diffContent: v.string(),
  truncated: v.boolean(),
  message: v.string(),
  author: v.string(),
  date: v.string(),
  filesChanged: v.number(),
  insertions: v.number(),
  deletions: v.number(),
  updatedAt: v.number(),
}
.index('by_machine_workingDir_sha', ['machineId', 'workingDir', 'sha'])
```

**Acceptance:**
- Schema deploys successfully to Convex
- Tables visible in Convex dashboard
- Indexes created correctly

---

## ⏸️ REVIEW CHECKPOINT 2

**Pause here for user review.**

At this point:
- Schema is defined and deployed
- No data flowing yet

**User validates:**
1. ✓ Table structure is correct
2. ✓ Field types match domain model
3. ✓ Indexes are appropriate
4. ✓ Discriminated union encoding is right

**Proceed to Phase 5 only after user approval.**

---

### Phase 5: Wire CLI → Backend (Daemon Push)

**Goal:** Connect daemon git-reader to backend. Daemon pushes git state on heartbeat (change-detected).

**Files:**
1. `packages/cli/src/infrastructure/git/push-git-state.ts` — **NEW**
   - `pushGitStateSummaryIfChanged(ctx)` function
   - Collects active workingDirs from agent configs
   - Runs git-reader for each workingDir
   - Compares with lastPushedGitState
   - Calls `api.workspaces.upsertWorkspaceGitState` if changed

2. `services/backend/convex/workspaces.ts` — **MODIFY**
   - Implement `upsertWorkspaceGitState` mutation (actually writes to DB)
   - Implement `getWorkspaceGitState` query (reads from DB)

3. `packages/cli/src/commands/machine/daemon-start/command-loop.ts` — **MODIFY**
   - Call `pushGitStateSummaryIfChanged` in heartbeat timer

**Acceptance:**
- Running daemon in a git repo creates `chatroom_workspaceGitState` row
- Row shows correct branch, isDirty, diffStat
- Non-git dir creates row with `status: 'not_found'`
- Repeated heartbeats don't create new writes if unchanged

---

### Phase 6: Wire Frontend → Backend (Read State)

**Goal:** Connect frontend hooks to real backend queries. Replace mock data with live subscriptions.

**Cleanup:** Remove hardcoded `machineId` fallback in `useWorkspaces.ts` (currently uses `hostname` as stand-in). Replace with real `machineId` from `WorkspaceView` after backend exposes it.

**Files:**
1. `apps/webapp/src/modules/chatroom/hooks/useWorkspaceGit.ts` — **MODIFY**
   - Replace mock data with `useSessionQuery(api.workspaces.getWorkspaceGitState)`
   - Transform backend response to discriminated union

2. `services/backend/src/domain/usecase/chatroom/get-agent-statuses.ts` — **MODIFY**
   - Ensure `WorkspaceView` exposes `machineId`

**Acceptance:**
- Opening workspace panel shows real git data from daemon
- Data updates live when branch changes
- Non-git workspaces show "Git info not found"

---

### Phase 7: On-Demand Full Diff

**Goal:** Wire the full diff request/response cycle.

**Files:**
1. `services/backend/convex/workspaces.ts` — **MODIFY**
   - Implement `requestFullDiff` mutation (inserts pending request)
   - Implement `getFullDiff` query
   - Implement `upsertFullDiff` mutation
   - Implement `getPendingRequests` query

2. `packages/cli/src/infrastructure/git/process-git-requests.ts` — **NEW**
   - `processGitRequests(ctx)` function
   - Polls `getPendingRequests`
   - Processes `full_diff` requests: runs git diff HEAD, calls upsertFullDiff

3. `packages/cli/src/commands/machine/daemon-start/git-polling.ts` — **MODIFY**
   - Call `processGitRequests` in fast loop

4. `apps/webapp/src/modules/chatroom/hooks/useWorkspaceGit.ts` — **MODIFY**
   - Implement `useFullDiff` with real backend calls

**Acceptance:**
- Clicking "Load Diff" triggers request
- Diff appears within ~5s
- Large diffs show truncation warning

---

### Phase 8: Git History + Load More

**Goal:** Wire commit history and pagination.

**Files:**
1. `services/backend/convex/workspaces.ts` — **MODIFY**
   - Implement `requestMoreCommits` mutation
   - Implement `appendMoreCommits` mutation

2. `packages/cli/src/infrastructure/git/process-git-requests.ts` — **MODIFY**
   - Process `more_commits` requests

3. `apps/webapp/src/modules/chatroom/hooks/useWorkspaceGit.ts` — **MODIFY**
   - Implement `useLoadMoreCommits` with real backend calls

**Acceptance:**
- History tab shows 20 real commits
- "Load More" fetches next 20
- Commits match actual git history

---

### Phase 9: Commit Detail

**Goal:** Wire commit detail request/response.

**Files:**
1. `services/backend/convex/workspaces.ts` — **MODIFY**
   - Implement `requestCommitDetail` mutation
   - Implement `getCommitDetail` query
   - Implement `upsertCommitDetail` mutation

2. `packages/cli/src/infrastructure/git/process-git-requests.ts` — **MODIFY**
   - Process `commit_detail` requests

3. `apps/webapp/src/modules/chatroom/hooks/useWorkspaceGit.ts` — **MODIFY**
   - Implement `useCommitDetail` with real backend calls

**Acceptance:**
- Clicking a commit shows loading state
- Diff appears within ~5s
- Back/Escape returns to log

---

### Phase 10: Polish + Edge Cases

**Goal:** Handle edge cases and polish the experience.

1. Dark mode audit for all new components
2. Handle detached HEAD (`git rev-parse` returns "HEAD" → display "detached @ <sha>")
3. Empty states: "No changes" when clean, "No commits" when empty
4. Stale timestamp display ("Last updated 5 min ago") using `updatedAt`
5. Error state styling and retry affordance
6. Performance: debounce keyboard navigation
7. Cleanup: remove any remaining mock data or debug code

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
