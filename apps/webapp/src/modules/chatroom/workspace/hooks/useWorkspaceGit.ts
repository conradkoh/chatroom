/**
 * Workspace Git — React Hooks (mock data)
 *
 * These hooks currently return mock data for UI development.
 * They will be replaced with real Convex queries in Phase 6.
 */

'use client';

import { useState, useCallback } from 'react';
import type {
  WorkspaceGitState,
  FullDiffState,
  CommitDetailState,
  GitCommit,
} from '../types/git';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_COMMITS: GitCommit[] = [
  {
    sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
    shortSha: 'a1b2c3d',
    message: 'feat(workspace): add git state push from daemon',
    author: 'Alice Chen',
    date: '2026-03-13T08:00:00.000Z',
  },
  {
    sha: 'b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3',
    shortSha: 'b2c3d4e',
    message: 'refactor(cli): use backend domain types for GitCommit and DiffStat',
    author: 'Alice Chen',
    date: '2026-03-13T07:30:00.000Z',
  },
  {
    sha: 'c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
    shortSha: 'c3d4e5f',
    message: 'fix(daemon): retry on transient network errors',
    author: 'Bob Smith',
    date: '2026-03-12T18:45:00.000Z',
  },
  {
    sha: 'd4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5',
    shortSha: 'd4e5f6a',
    message: 'chore: bump convex to 1.31.0',
    author: 'Bob Smith',
    date: '2026-03-12T14:20:00.000Z',
  },
  {
    sha: 'e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6',
    shortSha: 'e5f6a1b',
    message: 'docs: update architecture overview for Phase 2',
    author: 'Alice Chen',
    date: '2026-03-12T10:00:00.000Z',
  },
  {
    sha: 'f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1',
    shortSha: 'f6a1b2c',
    message: 'Merge branch "main" into feat/workspace-integration',
    author: 'Alice Chen',
    date: '2026-03-12T09:00:00.000Z',
  },
  {
    sha: 'a7b8c9d0e1f2a7b8c9d0e1f2a7b8c9d0e1f2a7b8',
    shortSha: 'a7b8c9d',
    message: 'chore: remove deprecated git helper utilities',
    author: 'Bob Smith',
    date: '2026-03-11T16:30:00.000Z',
  },
  {
    sha: 'b8c9d0e1f2a3b8c9d0e1f2a3b8c9d0e1f2a3b8c9',
    shortSha: 'b8c9d0e',
    message: 'refactor: migrate types and remove legacy module',
    author: 'Alice Chen',
    date: '2026-03-11T12:00:00.000Z',
  },
];

const MOCK_FULL_DIFF = `diff --git a/apps/webapp/src/modules/chatroom/components/WorkspaceGitPanel.tsx b/apps/webapp/src/modules/chatroom/components/WorkspaceGitPanel.tsx
new file mode 100644
index 0000000..1a2b3c4
--- /dev/null
+++ b/apps/webapp/src/modules/chatroom/components/WorkspaceGitPanel.tsx
@@ -0,0 +1,42 @@
+import React from 'react';
+import { useWorkspaceGit } from '../hooks/useWorkspaceGit';
+
+interface Props {
+  machineId: string;
+  workingDir: string;
+}
+
+export function WorkspaceGitPanel({ machineId, workingDir }: Props) {
+  const gitState = useWorkspaceGit(machineId, workingDir);
+
+  if (gitState.status === 'loading') {
+    return <div className="text-muted-foreground text-sm">Loading git state…</div>;
+  }
+
+  if (gitState.status === 'not_found') {
+    return <div className="text-muted-foreground text-sm">Not a git repository</div>;
+  }
+
+  if (gitState.status === 'error') {
+    return <div className="text-red-500 text-sm">{gitState.message}</div>;
+  }
+
+  return (
+    <div>
+      <p>{gitState.branch}</p>
+    </div>
+  );
+}
diff --git a/services/backend/src/domain/types/workspace-git.ts b/services/backend/src/domain/types/workspace-git.ts
index def5678..abc9012 100644
--- a/services/backend/src/domain/types/workspace-git.ts
+++ b/services/backend/src/domain/types/workspace-git.ts
@@ -15,6 +15,11 @@ export interface DiffStat {
   deletions: number;
 }
 
+/** Pagination info for commit log. */
+export interface CommitPage {
+  commits: GitCommit[];
+  hasMore: boolean;
+}
+
 /** A single commit entry from the git log. */
 export interface GitCommit {
diff --git a/packages/cli/src/infrastructure/git/types.ts b/packages/cli/src/infrastructure/git/types.ts
index 1234567..abcdef0 100644
--- a/packages/cli/src/infrastructure/git/types.ts
+++ b/packages/cli/src/infrastructure/git/types.ts
@@ -1,20 +1,10 @@
-/** Diff summary statistics from \`git diff HEAD --stat\`. */
-export interface GitDiffStat {
-  filesChanged: number;
-  insertions: number;
-  deletions: number;
-}
-
-/** A single commit entry from \`git log\`. */
-export interface GitCommit {
-  sha: string;
-  shortSha: string;
-  message: string;
-  author: string;
-  date: string;
-}
+import type { DiffStat, GitCommit } from '@workspace/backend/src/domain/types/workspace-git';
+export type { DiffStat, GitCommit };
+
+/** @deprecated Use DiffStat from the backend domain types. */
+export type GitDiffStat = DiffStat;`;

const MOCK_COMMIT_DIFF = `diff --git a/services/backend/src/domain/workspace-git-state.ts b/services/backend/src/domain/workspace-git-state.ts
new file mode 100644
index 0000000..9876543
--- /dev/null
+++ b/services/backend/src/domain/workspace-git-state.ts
@@ -0,0 +1,28 @@
+import { mutation, query } from '../_generated/server';
+import { v } from 'convex/values';
+
+export const pushGitState = mutation({
+  args: {
+    machineId: v.string(),
+    workingDir: v.string(),
+    branch: v.string(),
+    isDirty: v.boolean(),
+  },
+  handler: async (ctx, args) => {
+    // Upsert git state record
+    const existing = await ctx.db
+      .query('workspaceGitState')
+      .withIndex('by_machine_dir', (q) =>
+        q.eq('machineId', args.machineId).eq('workingDir', args.workingDir)
+      )
+      .unique();
+
+    if (existing) {
+      await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() });
+    } else {
+      await ctx.db.insert('workspaceGitState', { ...args, updatedAt: Date.now() });
+    }
+  },
+});`;

/** Mock diff for a commit that deletes files. */
const MOCK_DELETE_DIFF = `diff --git a/packages/cli/src/infrastructure/git/helpers.ts b/packages/cli/src/infrastructure/git/helpers.ts
deleted file mode 100644
index 1234567..0000000
--- a/packages/cli/src/infrastructure/git/helpers.ts
+++ /dev/null
@@ -1,25 +0,0 @@
-import { exec } from 'child_process';
-import { promisify } from 'util';
-
-const execAsync = promisify(exec);
-
-/**
- * Returns the current git branch name for the given directory.
- */
-export async function getGitBranch(dir: string): Promise<string> {
-  const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: dir });
-  return stdout.trim();
-}
-
-/**
- * Returns a simplified diff stat for the working tree.
- */
-export async function getGitDiffStat(
-  dir: string,
-): Promise<{ files: number; ins: number; del: number }> {
-  const { stdout } = await execAsync('git diff HEAD --stat', { cwd: dir });
-  return parseStatOutput(stdout);
-}
-
-function parseStatOutput(_stat: string) {
-  return { files: 0, ins: 0, del: 0 };
-}
diff --git a/packages/cli/src/infrastructure/git/index.ts b/packages/cli/src/infrastructure/git/index.ts
deleted file mode 100644
index abcdef1..0000000
--- a/packages/cli/src/infrastructure/git/index.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export { getGitBranch, getGitDiffStat } from './helpers';
-export type { GitDiffStat } from './types';
-export { parseGitLog } from './log';`;

/** Mock diff for a merge commit — mix of created, modified, and deleted files. */
const MOCK_MERGE_DIFF = `diff --git a/apps/webapp/src/modules/chatroom/workspace/components/WorkspaceGitBranch.tsx b/apps/webapp/src/modules/chatroom/workspace/components/WorkspaceGitBranch.tsx
index 0000000..abcdef2
--- /dev/null
+++ b/apps/webapp/src/modules/chatroom/workspace/components/WorkspaceGitBranch.tsx
@@ -0,0 +1,18 @@
+import { memo } from 'react';
+import type { WorkspaceGitState } from '../types/git';
+
+interface Props {
+  state: WorkspaceGitState;
+}
+
+export const WorkspaceGitBranch = memo(function WorkspaceGitBranch({ state }: Props) {
+  if (state.status !== 'available') {
+    return <div className="text-muted-foreground text-sm">Loading…</div>;
+  }
+  return (
+    <div className="flex flex-col gap-1">
+      <span className="text-xs font-mono">{state.branch}</span>
+      <span className="text-[11px] text-muted-foreground">{state.isDirty ? 'Dirty' : 'Clean'}</span>
+    </div>
+  );
+});
diff --git a/services/backend/src/domain/types/workspace-git.ts b/services/backend/src/domain/types/workspace-git.ts
index def5678..abc9012 100644
--- a/services/backend/src/domain/types/workspace-git.ts
+++ b/services/backend/src/domain/types/workspace-git.ts
@@ -10,6 +10,11 @@ export interface DiffStat {
   deletions: number;
 }
 
+/** Full diff content with truncation flag. */
+export interface FullDiff {
+  content: string;
+  truncated: boolean;
+}
+
 /** A single commit entry from the git log. */
 export interface GitCommit {
   sha: string;
@@ -20,3 +25,7 @@ export interface GitCommit {
   author: string;
   date: string;
 }
+
+/** Workspace git state as stored in Convex. */
+export interface WorkspaceGitRecord {
+  machineId: string;
+  workingDir: string;
diff --git a/packages/cli/src/infrastructure/git/helpers.ts b/packages/cli/src/infrastructure/git/helpers.ts
deleted file mode 100644
index 1234567..0000000
--- a/packages/cli/src/infrastructure/git/helpers.ts
+++ /dev/null
@@ -1,8 +0,0 @@
-import { exec } from 'child_process';
-import { promisify } from 'util';
-
-const execAsync = promisify(exec);
-
-export async function getGitBranch(dir: string): Promise<string> {
-  const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: dir });
-  return stdout.trim();
-}
diff --git a/apps/webapp/src/app/layout.tsx b/apps/webapp/src/app/layout.tsx
index 1111111..2222222 100644
--- a/apps/webapp/src/app/layout.tsx
+++ b/apps/webapp/src/app/layout.tsx
@@ -5,6 +5,7 @@ import { ThemeProvider } from '@/components/theme-provider';
 import { ConvexClientProvider } from '@/components/convex-client-provider';
 import { SessionProvider } from 'convex-helpers/react/sessions';
 import { Toaster } from '@/components/ui/toaster';
+import { WorkspaceProvider } from '@/modules/chatroom/workspace/WorkspaceProvider';
 
 export const metadata: Metadata = {
   title: 'Chatroom',
@@ -20,7 +21,9 @@ export default function RootLayout({
     <body className={inter.className}>
       <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
         <ConvexClientProvider>
-          <SessionProvider>{children}</SessionProvider>
+          <SessionProvider>
+            <WorkspaceProvider>{children}</WorkspaceProvider>
+          </SessionProvider>
         </ConvexClientProvider>
       </ThemeProvider>
     </body>`;


// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Returns the git state for a workspace (machine + working directory).
 *
 * Currently returns mock data. Will be replaced with a real Convex query in Phase 6.
 */
export function useWorkspaceGit(
  _machineId: string,
  _workingDir: string,
): WorkspaceGitState {
  return {
    status: 'available',
    branch: 'feat/workspace-integration',
    isDirty: true,
    diffStat: { filesChanged: 7, insertions: 156, deletions: 43 },
    recentCommits: MOCK_COMMITS,
    hasMoreCommits: true,
    updatedAt: Date.now(),
  };
}

/**
 * Returns full diff state and a request function.
 *
 * Transitions: idle → loading (1 s) → available.
 * Will be replaced with a real on-demand Convex mutation in Phase 6.
 */
export function useFullDiff(
  _machineId: string,
  _workingDir: string,
): { state: FullDiffState; request: () => void } {
  const [state, setState] = useState<FullDiffState>({ status: 'idle' });

  const request = useCallback(() => {
    setState({ status: 'loading' });
    setTimeout(() => {
      setState({
        status: 'available',
        content: MOCK_FULL_DIFF,
        truncated: false,
        diffStat: { filesChanged: 3, insertions: 78, deletions: 14 },
      });
    }, 1000);
  }, []);

  return { state, request };
}

/**
 * Returns commit detail state, a request function, and a clear function.
 *
 * Transitions: idle → loading (1 s) → available.  clear() resets to idle.
 * Will be replaced with a real on-demand Convex mutation in Phase 6.
 */
export function useCommitDetail(
  _machineId: string,
  _workingDir: string,
): { state: CommitDetailState; request: (sha: string) => void; clear: () => void } {
  const [state, setState] = useState<CommitDetailState>({ status: 'idle' });

  const request = useCallback((sha: string) => {
    setState({ status: 'loading' });
    setTimeout(() => {
      const commit = MOCK_COMMITS.find((c) => c.sha === sha || c.shortSha === sha);

      // Return different diffs based on SHA prefix
      let mockDiff = MOCK_COMMIT_DIFF;
      let diffStat = { filesChanged: 1, insertions: 28, deletions: 0 };

      if (sha.startsWith('a7b8')) {
        // delete commit
        mockDiff = MOCK_DELETE_DIFF;
        diffStat = { filesChanged: 2, insertions: 0, deletions: 28 };
      } else if (sha.startsWith('f6a1')) {
        // merge commit — mixed operations
        mockDiff = MOCK_MERGE_DIFF;
        diffStat = { filesChanged: 4, insertions: 45, deletions: 17 };
      }

      setState({
        status: 'available',
        content: mockDiff,
        truncated: false,
        message: commit?.message ?? 'Mock commit message',
        author: commit?.author ?? 'Unknown Author',
        date: commit?.date ?? new Date().toISOString(),
        diffStat,
      });
    }, 1000);
  }, []);

  const clear = useCallback(() => {
    setState({ status: 'idle' });
  }, []);

  return { state, request, clear };
}

/**
 * Returns a loading flag and a loadMore function for paginating commits.
 *
 * Will fetch and append additional commits in Phase 6+.
 */
export function useLoadMoreCommits(
  _machineId: string,
  _workingDir: string,
): { loading: boolean; loadMore: () => void } {
  const [loading, setLoading] = useState(false);

  const loadMore = useCallback(() => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
    }, 1000);
  }, []);

  return { loading, loadMore };
}
