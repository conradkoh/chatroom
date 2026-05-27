# Phase 0 Audit: WorkspaceGitState Eager-vs-On-Demand Contract

## Objective

Audit all WorkspaceGitState consumers and define which fields must be eagerly synced during observed-sync vs. which can be fetched on-demand. This audit is driven by the user's explicitly stated requirements, not by current UI convenience.

---

## 1. User-Stated Requirements (Priority Order)

The user has explicitly defined what constitutes "main info" vs. "on-demand":

1. **Core / Eager:** branch name, PR number, status checks
2. **On-demand:** everything else in the git panel
3. **Focus/refresh triggered:** git diff (diffStat), full diff
4. **Event-driven:** status checks may also be refreshed by specific events

This means the eager observed summary must be **much slimmer** than today's full payload. The current UI shows more data in the bottom bar, but that is an implementation detail to adapt — the contract should serve the user's stated requirements.

---

## 2. WorkspaceGitState Field Inventory

| Field                 | Type                        | UI Consumers                                                             | Daemon Source                     | Cost     | Proposed Category                               |
| --------------------- | --------------------------- | ------------------------------------------------------------------------ | --------------------------------- | -------- | ----------------------------------------------- |
| `branch`              | string                      | WorkspaceBottomBar, WorkspaceGitPanel, CommandPalette                    | `gitReader.getBranch`             | Low      | **Eager**                                       |
| `isDirty`             | boolean                     | Implicit via diffStat                                                    | `gitReader.isDirty`               | Low      | **Eager** (needed for dirty badge)              |
| `diffStat`            | DiffStat                    | WorkspaceBottomBar                                                       | `gitReader.getDiffStat`           | Low      | **Event-triggered / refresh**                   |
| `recentCommits`       | GitCommit[]                 | WorkspaceGitPanel (log tab)                                              | `gitReader.getRecentCommits(20)`  | Moderate | **On-demand**                                   |
| `hasMoreCommits`      | boolean                     | WorkspaceGitPanel                                                        | commit count check                | Low      | **On-demand**                                   |
| `remotes`             | GitRemote[]                 | WorkspaceBottomBar, CommandPalette, ChatroomDashboard                    | `gitReader.getRemotes`            | Low      | **On-demand** (or eager-until-UI-adapted)       |
| `commitsAhead`        | number                      | WorkspaceBottomBar (push indicator)                                      | `gitReader.getCommitsAhead`       | Low      | **Event-triggered / refresh**                   |
| `openPullRequests`    | GitPullRequest[]            | WorkspaceBottomBar, WorkspaceGitPanel, CommandPalette, ChatroomDashboard | `gitReader.getOpenPRsForBranch`   | Moderate | **Eager** (PR number is core data)              |
| `allPullRequests`     | GitPullRequest[]            | WorkspaceGitPanel PRs tab only                                           | `gitReader.getAllPRs`             | **High** | **On-demand**                                   |
| `headCommitStatus`    | CommitStatusSummary         | WorkspaceBottomBar (CommitStatusIndicator)                               | `gitReader.getCommitStatusChecks` | **High** | **Eager** (user explicitly wants status checks) |
| `defaultBranch`       | string \| null              | **None found**                                                           | Not sent by daemon                | N/A      | **Legacy**                                      |
| `defaultBranchStatus` | CommitStatusSummary \| null | **None found**                                                           | Not sent by daemon                | N/A      | **Legacy**                                      |

---

## 3. UI Consumer Field Usage (File References)

### WorkspaceBottomBar.tsx (`useDerivedGitInfo`)

- `branch` → `branchDisplay` (line 175)
- `diffStat` → `InlineDiffStat` (line 170)
- `remotes` → `RemotePopover`, `repoHttpsUrl`, `isGitHubRepo` (line 168)
- `openPullRequests` → `hasPR`, PR number, PR URL, PR title (line 169)
- `headCommitStatus` → `CommitStatusIndicator` (line 171)
- `commitsAhead` → implicit in branch display logic

### WorkspaceGitPanel.tsx

- `branch` → displayed in "No PR" message (line 353)
- `recentCommits` → `WorkspaceGitLog` (line 369)
- `hasMoreCommits` → load-more button (line 370)
- `openPullRequests` → `activePR` for Current Branch tab (line 73-74)
- `allPullRequests` → PR list with open/closed/merged filtering (line 160)

### useWorkspaceCommandItems.tsx (CommandPalette)

- `remotes` → `repoUrl` for GitHub links (line 93)
- `openPullRequests` → PR URL for commands (line 95)

### ChatroomDashboard.tsx

- `openPullRequests` → `prUrl` (line 802)
- `remotes` → `gitHubRepoUrl` (line 809)

---

## 4. Revised Categorization

### Eager Observed Summary (must be in every observed sync payload)

Driven by user's explicitly stated core data:

- `branch` — primary identifier, always needed
- `isDirty` — needed for dirty badge indicator
- `openPullRequests` — user explicitly wants PR number; needed for bottom bar PR indicator
- `headCommitStatus` — user explicitly wants status checks; expensive but core

**Rationale:** The user said "main info needed is branch name, PR number, and status checks." We honor that exactly. `isDirty` is essentially free and needed for the dirty badge. All other fields move out of the eager path.

### Event-Triggered Immediate Summary Refresh

These are needed for the bottom bar but should follow focus/visibility or explicit refresh events, not every observed-sync safety poll:

- `diffStat` — visible in bottom bar, but user said diff should follow focus/refresh behavior
- `commitsAhead` — push indicator, can be refreshed on focus/visibility
- `remotes` — needed for GitHub links, but can be fetched on first focus or when repo actions are needed

**Tradeoff note:** `remotes` is very cheap (`git remote -v`), so it could remain eager for simplicity. However, the user's requirements suggest a slimmer contract. We keep it in this category as a compromise — it can be promoted to eager if the UI adaptation cost is too high.

### On-Demand Heavy Metadata

These are only needed in specific UI contexts and should be fetched on-demand:

- `allPullRequests` — only shown when user opens the PRs tab. Requires `gh pr list --limit 20 --state all`. **No existing on-demand path.**
- `recentCommits` — only shown in log tab. Currently 20 commits on every push. **No existing on-demand path for initial load** (only `requestMoreCommits` for pagination).
- `hasMoreCommits` — paired with recentCommits.

### Legacy / Full-Sync Only

These fields exist in the schema and type but are **not consumed by any UI component** and are **not even sent by the daemon**:

- `defaultBranch` — returned by `getWorkspaceGitState` with `?? null` fallback, but no UI reads it.
- `defaultBranchStatus` — same; dead weight in type and schema.

### Behavior to Gate for Observed Sync

- `prefetchMissingCommitDetails` — currently runs after every `pushSingleWorkspaceGitState`. For observed sync, this should be skipped or made on-demand to reduce daemon load.

---

## 5. Tradeoff Analysis: headCommitStatus

**Conflict:** `headCommitStatus` is expensive (GitHub API call) but the user explicitly listed status checks as core data.

**Options:**

1. **Keep eager** — simplest, honors user requirements exactly, but increases daemon load per observed sync push.
2. **Move to event-triggered** — fetch on focus/visibility events or when branch changes. Slightly more complex but reduces polling load.
3. **Move to on-demand** — contradicts user's stated requirements; would require UI to show loading state for status checks in bottom bar.

**Recommendation:** Keep `headCommitStatus` eager for Phase 1-3. If daemon profiling shows it is a bottleneck, revisit in Phase 6 (tuning). The user was clear that status checks are main info.

---

## 6. Existing On-Demand Request Patterns

The frontend already uses a mature request→subscribe pattern for heavy data:

| Data          | Request Mutation      | Query                      | Daemon Handler                               |
| ------------- | --------------------- | -------------------------- | -------------------------------------------- |
| Full diff     | `requestFullDiff`     | `getFullDiffV2`            | Reads `chatroom_workspaceDiffRequests` table |
| Commit detail | `requestCommitDetail` | `getCommitDetailV2`        | Reads `chatroom_workspaceDiffRequests` table |
| PR diff       | `requestPRDiff`       | `getPRDiff`                | Reads `chatroom_workspaceDiffRequests` table |
| PR commits    | `requestPRCommits`    | `getPRCommits`             | Reads `chatroom_workspaceDiffRequests` table |
| More commits  | `requestMoreCommits`  | N/A (appends to git state) | Reads `chatroom_workspaceDiffRequests` table |
| Git refresh   | `requestGitRefresh`   | N/A (pushes via event)     | `daemon.gitRefresh` event → `pushGitState`   |

All requests use `chatroom_workspaceDiffRequests` as a pending-request queue. The daemon polls this table on its fast loop.

---

## 7. Recommended Contract

```
Eager Observed Summary (every push):
  branch, isDirty, openPullRequests, headCommitStatus

Event-Triggered Summary Refresh (on focus/visibility/gitRefresh):
  diffStat, commitsAhead, remotes

On-Demand Heavy Metadata (new request types needed):
  allPullRequests  → requestAllPullRequests / getAllPullRequests
  recentCommits    → requestRecentCommits / getRecentCommits (or extend requestMoreCommits for offset=0)

Legacy (omit from observed sync; can be removed from schema in future):
  defaultBranch, defaultBranchStatus

Gated for Observed Sync:
  prefetchMissingCommitDetails (skip entirely in observed mode)
```

### Backend Changes Needed (Phase 1-3)

1. Add `requestAllPullRequests` mutation + `getAllPullRequests` query
2. Add `requestRecentCommits` mutation (or allow `requestMoreCommits` with `offset=0` for initial load) + ensure query path exists
3. Update `upsertWorkspaceGitState` to accept a slimmer payload (optional fields already supported)
4. Consider deprecating `defaultBranch` / `defaultBranchStatus` from schema + type

### Daemon Changes Needed (Phase 2-4)

1. Add observed-only path in `pushSingleWorkspaceGitState` that fetches only:
   - `branch`, `isDirty`, `openPullRequests`, `headCommitStatus`
2. Skip in observed mode:
   - `gitReader.getDiffStat`
   - `gitReader.getCommitsAhead`
   - `gitReader.getRemotes`
   - `gitReader.getAllPRs`
   - `gitReader.getRecentCommits`
   - `prefetchMissingCommitDetails`
3. Add handlers for new request types (`all_pull_requests`, `recent_commits`)
4. Event-triggered refresh (focus/visibility): re-fetch event-triggered fields on `daemon.gitRefresh`

### UI Changes Needed (Phase 5-7)

1. `WorkspaceGitPanel` PRs tab: use `useAllPullRequests` hook (on-demand)
2. `WorkspaceGitPanel` log tab: use `useRecentCommits` hook (on-demand, offset=0)
3. `WorkspaceBottomBar`: show loading/fallback states when `diffStat`, `remotes`, or `commitsAhead` are absent from eager sync
4. On focus/visibility: trigger `gitRefresh` to fetch event-triggered fields

---

## 8. Proposed Test Targets

| Test                                  | Location                                                                    | What it verifies                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `getWorkspaceGitState` missing fields | `services/backend/tests/integration/upsert-workspace-git-state-*.spec.ts`   | Returns `null` / empty defaults when `diffStat`, `remotes`, `recentCommits`, `allPullRequests` are absent               |
| Observed-sync payload shape           | New: `services/backend/tests/integration/observed-sync-payload.spec.ts`     | Daemon upsert only includes eager fields; event-triggered and heavy fields omitted                                      |
| UI graceful degradation               | New or existing component tests                                             | Bottom bar renders without `diffStat` (shows "loading…" or clean state); log tab shows skeleton without `recentCommits` |
| Daemon observed-only gating           | New: `packages/cli/tests/daemon/git-heartbeat.spec.ts`                      | `pushSingleWorkspaceGitState` skips non-eager fields when `observedOnly=true`                                           |
| On-demand request plumbing            | New: `services/backend/tests/integration/request-all-pull-requests.spec.ts` | Idempotent request insertion + daemon fulfillment for `allPullRequests`                                                 |
| On-demand recent commits              | New: `services/backend/tests/integration/request-recent-commits.spec.ts`    | Idempotent request insertion + daemon fulfillment for `recentCommits` (offset=0)                                        |

---

## 9. Risk Notes

- `diffStat` is currently visible in the bottom bar on every view. Moving it to event-triggered means the bottom bar may show "loading…" or a clean state until focus/refresh. This is acceptable per user's requirements but needs UI adaptation.
- `remotes` is very cheap to fetch. If UI adaptation for on-demand remotes is too complex, it can be promoted to eager without significant cost.
- `openPullRequests` is moderate cost but user explicitly wants PR number. Keep eager.
- `headCommitStatus` is expensive but user explicitly wants status checks. Keep eager; revisit in Phase 6 if needed.
- `recentCommits` is the biggest payload reduction — 20 commits × ~200 bytes each = ~4KB removed from every push.
- `defaultBranch` / `defaultBranchStatus` are true dead code — safe to remove from the type/schema but out of scope for observed-sync work.
