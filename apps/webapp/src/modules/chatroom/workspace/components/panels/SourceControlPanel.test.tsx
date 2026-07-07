/**
 * Unit tests for SourceControlPanel.
 *
 * Tests: left rail render (diff summary + commit list), click commit → files appear,
 * click file → WorkspaceDiffViewer rendered, empty states.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Tests ────────────────────────────────────────────────────────────────────

import { SourceControlPanel, groupFilesByDirectory } from './SourceControlPanel';
import type { FileDiffSection } from '../../utils/diff-parser';

// ─── Mocks ────────────────────────────────────────────────────────────────────

let mockGitState: Record<string, unknown> = { status: 'loading' };
let mockFullDiffState: Record<string, unknown> = { status: 'idle' };
let mockCommitDetailState: Record<string, unknown> = { status: 'idle' };
let mockRecentCommitsState: Record<string, unknown> = { status: 'idle' };

const mockRequestFullDiff = vi.fn();
const mockRequestCommitDetail = vi.fn();
const mockRequestRecentCommits = vi.fn();
const mockLoadMore = vi.fn();

vi.mock('../../hooks/useWorkspaceGit', () => ({
  useWorkspaceGit: () => mockGitState,
  useFullDiff: () => ({ state: mockFullDiffState, request: mockRequestFullDiff }),
  useCommitDetail: () => ({
    state: mockCommitDetailState,
    request: mockRequestCommitDetail,
    clear: vi.fn(),
  }),
  useRecentCommits: () => ({ state: mockRecentCommitsState, request: mockRequestRecentCommits }),
  useLoadMoreCommits: () => ({ loading: false, loadMore: mockLoadMore }),
}));

// Mock WorkspaceGitLog to a simple list for test assertability
vi.mock('../WorkspaceGitLog', () => ({
  WorkspaceGitLog: ({
    commits,
    onSelectCommit,
    onRequest,
    status,
  }: {
    commits: { sha: string; shortSha: string; message: string }[];
    onSelectCommit: (sha: string) => void;
    onRequest: () => void;
    status?: string;
  }) => (
    <div data-testid="git-log">
      {status === 'idle' && (
        <button onClick={onRequest} data-testid="load-commits">
          Load commits
        </button>
      )}
      {commits.map((c) => (
        <button key={c.sha} onClick={() => onSelectCommit(c.sha)} data-testid={`commit-${c.sha}`}>
          {c.shortSha}: {c.message}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../WorkspaceDiffViewer', () => ({
  WorkspaceDiffViewer: ({ state }: { state: { status: string; content?: string } }) => (
    <div data-testid="diff-viewer" data-status={state.status}>
      {state.status === 'available' ? state.content : state.status}
    </div>
  ),
}));

// Mock resizable panels so tests don't depend on react-resizable-panels internals
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div className={className} data-testid="resizable-group">
      {children}
    </div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

// ─── Test data ────────────────────────────────────────────────────────────────

const COMMIT_A = {
  sha: 'aaaa1111',
  shortSha: 'aaaa111',
  message: 'feat: add feature',
  author: 'alice',
  date: '2024-01-01',
};
const COMMIT_B = {
  sha: 'bbbb2222',
  shortSha: 'bbbb222',
  message: 'fix: bug fix',
  author: 'bob',
  date: '2024-01-02',
};
const COMMIT_WITH_BODY = {
  sha: 'cccc3333',
  shortSha: 'cccc333',
  message: 'feat: implement #482 feature',
  body: 'This implements the feature described in #482.',
  author: 'charlie',
  date: '2024-01-03',
};
const REMOTE_ORIGIN = { name: 'origin', url: 'https://github.com/conradkoh/chatroom.git' };

// A minimal unified diff with two files
const FULL_DIFF_CONTENT = `diff --git a/src/foo.ts b/src/foo.ts
index 123..456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,3 @@
 const x = 1;
+const y = 2;
diff --git a/src/bar.ts b/src/bar.ts
index abc..def 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -1 +1,2 @@
 export {};
+// added`;

describe('SourceControlPanel', () => {
  beforeEach(() => {
    mockGitState = { status: 'loading' };
    mockFullDiffState = { status: 'idle' };
    mockCommitDetailState = { status: 'idle' };
    mockRecentCommitsState = { status: 'idle' };
    vi.clearAllMocks();
  });

  // ── Left rail: loading state ───────────────────────────────────────────

  it('renders loading indicator while git state is loading', () => {
    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);
    // Loading state in "Changes" section
    expect(screen.getAllByText(/Loading/i).length).toBeGreaterThan(0);
  });

  // ── Left rail: dirty working tree ────────────────────────────────────

  it('renders working-tree diff summary when isDirty=true', () => {
    mockGitState = {
      status: 'available',
      isDirty: true,
      diffStat: { filesChanged: 3, insertions: 10, deletions: 2 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = { status: 'idle' };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    expect(screen.getByText('Working Changes')).toBeTruthy();
    expect(screen.getByText(/3 file/)).toBeTruthy();
  });

  // ── Left rail: clean working tree ────────────────────────────────────

  it('renders "No uncommitted changes" when isDirty=false', () => {
    mockGitState = {
      status: 'available',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = { status: 'available', commits: [], hasMoreCommits: false };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    expect(screen.getByText(/No uncommitted changes/i)).toBeTruthy();
  });

  // ── Left rail: commit list ────────────────────────────────────────────

  it('renders commit list from useRecentCommits', () => {
    mockGitState = {
      status: 'available',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = {
      status: 'available',
      commits: [COMMIT_A, COMMIT_B],
      hasMoreCommits: false,
    };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    expect(screen.getByTestId('git-log')).toBeTruthy();
    expect(screen.getByTestId(`commit-${COMMIT_A.sha}`)).toBeTruthy();
    expect(screen.getByTestId(`commit-${COMMIT_B.sha}`)).toBeTruthy();
  });

  // ── Middle: empty when nothing selected ──────────────────────────────

  it('shows "Select a change or commit" empty state in middle when nothing selected', () => {
    mockGitState = {
      status: 'available',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = { status: 'available', commits: [COMMIT_A], hasMoreCommits: false };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    expect(screen.getByText(/Select a change or commit/i)).toBeTruthy();
  });

  // ── Click commit → middle gets files ─────────────────────────────────

  it('clicking a commit populates the middle file list from commit detail', () => {
    mockGitState = {
      status: 'available',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = { status: 'available', commits: [COMMIT_A], hasMoreCommits: false };
    mockCommitDetailState = {
      status: 'available',
      content: FULL_DIFF_CONTENT,
      truncated: false,
      message: COMMIT_A.message,
      author: COMMIT_A.author,
      date: COMMIT_A.date,
      diffStat: { filesChanged: 2, insertions: 2, deletions: 0 },
    };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    // Click the commit
    fireEvent.click(screen.getByTestId(`commit-${COMMIT_A.sha}`));

    // Middle column should now show the file list (foo.ts and bar.ts)
    expect(screen.getByText('foo.ts')).toBeTruthy();
    expect(screen.getByText('bar.ts')).toBeTruthy();
  });

  // ── Click file → right gets diff viewer ──────────────────────────────

  it('clicking a file in the middle column shows the diff in the right column', () => {
    mockGitState = {
      status: 'available',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = { status: 'available', commits: [COMMIT_A], hasMoreCommits: false };
    mockCommitDetailState = {
      status: 'available',
      content: FULL_DIFF_CONTENT,
      truncated: false,
      message: COMMIT_A.message,
      author: COMMIT_A.author,
      date: COMMIT_A.date,
      diffStat: { filesChanged: 2, insertions: 2, deletions: 0 },
    };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    // Click the commit to show file list
    fireEvent.click(screen.getByTestId(`commit-${COMMIT_A.sha}`));

    // Click a file
    const fooFile = screen.getByText('foo.ts');
    fireEvent.click(fooFile.closest('button')!);

    // Right column should show the diff viewer
    expect(screen.getByTestId('diff-viewer')).toBeTruthy();
  });

  // ── Right empty state ─────────────────────────────────────────────────

  it('shows "Select a file" empty state in right column when no file selected', () => {
    mockGitState = {
      status: 'available',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = { status: 'available', commits: [COMMIT_A], hasMoreCommits: false };
    mockCommitDetailState = {
      status: 'available',
      content: FULL_DIFF_CONTENT,
      truncated: false,
      message: COMMIT_A.message,
      author: COMMIT_A.author,
      date: COMMIT_A.date,
      diffStat: { filesChanged: 2, insertions: 2, deletions: 0 },
    };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    // Click commit — middle shows files, right still shows empty state
    fireEvent.click(screen.getByTestId(`commit-${COMMIT_A.sha}`));

    expect(screen.getByText(/Select a file to view its diff/i)).toBeTruthy();
  });

  // ── Commit detail header: not shown for working tree ─────────────────

  it('does not render commit header when working tree is selected', () => {
    mockGitState = {
      status: 'available',
      isDirty: true,
      diffStat: { filesChanged: 1, insertions: 5, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = { status: 'available', commits: [COMMIT_A], hasMoreCommits: false };
    mockFullDiffState = {
      status: 'available',
      content: FULL_DIFF_CONTENT,
      truncated: false,
      diffStat: { filesChanged: 1, insertions: 5, deletions: 0 },
    };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    // Select working tree
    fireEvent.click(screen.getByText('Working Changes'));

    expect(mockRequestFullDiff).toHaveBeenCalled();
    // Commit header should NOT be rendered — no commit shortSha visible in header
    expect(screen.queryByText('aaaa111')).toBeNull();
  });

  it('requests a fresh working-tree diff when a file is selected', () => {
    mockGitState = {
      status: 'available',
      isDirty: true,
      diffStat: { filesChanged: 2, insertions: 2, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = { status: 'available', commits: [COMMIT_A], hasMoreCommits: false };
    mockFullDiffState = {
      status: 'available',
      content: FULL_DIFF_CONTENT,
      truncated: false,
      diffStat: { filesChanged: 2, insertions: 2, deletions: 0 },
    };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    fireEvent.click(screen.getByText('Working Changes'));
    mockRequestFullDiff.mockClear();

    fireEvent.click(screen.getByText('foo.ts').closest('button')!);

    expect(mockRequestFullDiff).toHaveBeenCalled();
  });

  // ── Commit detail header: renders title + body + metadata ────────────

  it('renders commit header with title, body, and metadata when a commit with body is selected', () => {
    mockGitState = {
      status: 'available',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = {
      status: 'available',
      commits: [COMMIT_WITH_BODY],
      hasMoreCommits: false,
    };
    mockCommitDetailState = {
      status: 'available',
      content: FULL_DIFF_CONTENT,
      truncated: false,
      message: COMMIT_WITH_BODY.message,
      author: COMMIT_WITH_BODY.author,
      date: COMMIT_WITH_BODY.date,
      diffStat: { filesChanged: 2, insertions: 2, deletions: 0 },
    };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    // Click the commit
    fireEvent.click(screen.getByTestId(`commit-${COMMIT_WITH_BODY.sha}`));

    // Title should be rendered — commit message appears in header AND in git log mock
    expect(screen.getAllByText(/implement #482 feature/).length).toBeGreaterThanOrEqual(1);
    // Body text rendered (split by linkified #482 anchor)
    expect(screen.getByText(/implements the feature described in/)).toBeTruthy();
    // Metadata: shortSha, author
    expect(screen.getByText('cccc333')).toBeTruthy();
    expect(screen.getByText('charlie')).toBeTruthy();
  });

  // ── Commit detail header: linkified GitHub refs ──────────────────────

  it('linkifies #482 in commit title as a GitHub issue link when repoSlug is available', () => {
    mockGitState = {
      status: 'available',
      isDirty: false,
      diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      branch: 'main',
      openPullRequests: [],
      allPullRequests: [],
      remotes: [REMOTE_ORIGIN],
      commitsAhead: 0,
      updatedAt: Date.now(),
    };
    mockRecentCommitsState = {
      status: 'available',
      commits: [COMMIT_WITH_BODY],
      hasMoreCommits: false,
    };
    mockCommitDetailState = {
      status: 'available',
      content: FULL_DIFF_CONTENT,
      truncated: false,
      message: COMMIT_WITH_BODY.message,
      author: COMMIT_WITH_BODY.author,
      date: COMMIT_WITH_BODY.date,
      diffStat: { filesChanged: 2, insertions: 2, deletions: 0 },
    };

    render(<SourceControlPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    // Click the commit
    fireEvent.click(screen.getByTestId(`commit-${COMMIT_WITH_BODY.sha}`));

    // Find anchor tags that link to the GitHub issue
    const links = screen.getAllByRole('link');
    const issueLink = links.find((a) => a.getAttribute('href')?.includes('/issues/482'));
    expect(issueLink).toBeTruthy();
    expect(issueLink!.getAttribute('href')).toBe(
      'https://github.com/conradkoh/chatroom/issues/482'
    );
  });
});

// ─── groupFilesByDirectory unit tests ────────────────────────────────────────

const makeFile = (filePath: string): FileDiffSection => ({
  filePath,
  status: 'modified',
  lines: [],
});

describe('groupFilesByDirectory', () => {
  it('places root-level files in the "." group', () => {
    const files = [makeFile('README.md'), makeFile('package.json')];
    const groups = groupFilesByDirectory(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].dir).toBe('.');
    expect(groups[0].files.map((f) => f.filePath)).toEqual(['package.json', 'README.md']);
  });

  it('groups nested files by directory', () => {
    const files = [makeFile('src/foo.ts'), makeFile('src/bar.ts'), makeFile('lib/baz.ts')];
    const groups = groupFilesByDirectory(files);
    expect(groups).toHaveLength(2);
    expect(groups[0].dir).toBe('lib');
    expect(groups[1].dir).toBe('src');
  });

  it('handles mixed root and nested files', () => {
    const files = [makeFile('index.ts'), makeFile('src/utils.ts'), makeFile('src/types.ts')];
    const groups = groupFilesByDirectory(files);
    // Groups sorted alphabetically: "." < "src"
    expect(groups[0].dir).toBe('.');
    expect(groups[1].dir).toBe('src');
    // Files within src sorted by basename
    expect(groups[1].files.map((f) => f.filePath)).toEqual(['src/types.ts', 'src/utils.ts']);
  });

  it('sorts groups alphabetically and files within group alphabetically by basename', () => {
    const files = [makeFile('z/z.ts'), makeFile('a/b.ts'), makeFile('a/a.ts'), makeFile('m/m.ts')];
    const groups = groupFilesByDirectory(files);
    expect(groups.map((g) => g.dir)).toEqual(['a', 'm', 'z']);
    expect(groups[0].files.map((f) => f.filePath)).toEqual(['a/a.ts', 'a/b.ts']);
  });

  it('returns empty array for empty input', () => {
    expect(groupFilesByDirectory([])).toEqual([]);
  });
});
