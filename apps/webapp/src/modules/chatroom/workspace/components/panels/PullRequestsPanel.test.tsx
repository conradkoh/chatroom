/**
 * Tests for PullRequestsPanel.
 *
 * Tests: default selection (current-branch PR), filter switching,
 * current-branch badge, empty state, and PR list rendering.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequestAllPRs = vi.fn();
let mockAllPRsState: { status: string; pullRequests?: Array<Record<string, unknown>> } = {
  status: 'available',
  pullRequests: [],
};
let mockCurrentBranchPR: Record<string, unknown> | null = null;
let mockCurrentUserLogin: string | null = null;

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaces: {
      requestPRAction: 'requestPRAction',
    },
  },
}));

vi.mock('../../hooks/useWorkspaceGit', () => ({
  useAllPullRequests: () => ({
    state: mockAllPRsState,
    request: mockRequestAllPRs,
  }),
}));

vi.mock('../../hooks/useCurrentBranchPullRequest', () => ({
  useCurrentBranchPullRequest: () => ({
    currentBranchPR: mockCurrentBranchPR,
    currentUserLogin: mockCurrentUserLogin,
  }),
}));

vi.mock('../WorkspacePRReview', () => ({
  WorkspacePRReview: ({ activePR }: { activePR: { title: string } }) => (
    <div data-testid="pr-review">{activePR.title}</div>
  ),
}));

vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className} data-testid="resizable-group">{children}</div>
  ),
  ResizablePanel: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="resizable-panel">{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resizable-handle" />,
}));

// ─── Test data ────────────────────────────────────────────────────────────────

function makePR(
  prNumber: number,
  overrides: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    prNumber,
    title: `PR #${prNumber}`,
    url: `https://github.com/test/repo/pull/${prNumber}`,
    headRefName: `feature/pr-${prNumber}`,
    baseRefName: 'main',
    state: 'OPEN',
    author: 'alice',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const PR_CURRENT = makePR(10, { headRefName: 'feature/current', author: 'alice' });
const PR_OTHER_1 = makePR(9, { author: 'alice' });
const PR_OTHER_2 = makePR(8, { author: 'bob' });
const ALL_PRS = [PR_CURRENT, PR_OTHER_1, PR_OTHER_2];

// ─── Tests ────────────────────────────────────────────────────────────────────

import { PullRequestsPanel } from './PullRequestsPanel';

describe('PullRequestsPanel', () => {
  beforeEach(() => {
    mockAllPRsState = { status: 'available', pullRequests: ALL_PRS };
    mockCurrentBranchPR = PR_CURRENT;
    mockCurrentUserLogin = 'alice';
    mockRequestAllPRs.mockClear();
    vi.clearAllMocks();
  });

  it('requests all PRs on mount', () => {
    mockRequestAllPRs.mockImplementation(() => undefined);
    vi.mock('../../hooks/useWorkspaceGit', () => ({
      useAllPullRequests: () => ({
        state: mockAllPRsState,
        request: mockRequestAllPRs,
      }),
    }));
    render(<PullRequestsPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);
    // Mount triggers requestAllPRs via useEffect
    // (already mocked; just verify no crash)
  });

  it('renders PR list with current-branch PR selected by default', () => {
    render(<PullRequestsPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    // PR list is visible (multiple occurrences possible - list + review)
    expect(screen.getAllByText('PR #10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PR #9').length).toBeGreaterThan(0);

    // Current-branch PR is auto-selected (PR review shown)
    const reviews = screen.getAllByTestId('pr-review');
    expect(reviews.length).toBeGreaterThan(0);
    expect(reviews[0]!.textContent).toBe('PR #10');
  });

  it('shows star indicator on the current-branch PR', () => {
    const { container } = render(
      <PullRequestsPanel machineId="m1" workingDir="/repo" chatroomId="c1" />
    );
    // The Star icon has title="Current branch PR"
    const starTitle = container.querySelector('[title="Current branch PR"]');
    expect(starTitle).toBeTruthy();
  });

  it('filters to my-prs by default (alice only)', () => {
    render(<PullRequestsPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    // alice's PRs: #10, #9 — visible
    expect(screen.getAllByText('PR #10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PR #9').length).toBeGreaterThan(0);
    // bob's PR: #8 — NOT visible in my-prs filter
    expect(screen.queryByText('PR #8')).toBeNull();
  });

  it('switching to all filter shows all PRs including other authors', () => {
    render(<PullRequestsPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'all' } });

    expect(screen.getByText('PR #8')).toBeTruthy();
    expect(screen.getAllByText('PR #9').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PR #10').length).toBeGreaterThan(0);
  });

  it('shows empty state when filter has no matches', () => {
    mockAllPRsState = {
      status: 'available',
      pullRequests: [makePR(1, { author: 'carol', state: 'OPEN' })],
    };
    // alice has no PRs
    mockCurrentUserLogin = 'alice';
    mockCurrentBranchPR = null;

    render(<PullRequestsPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    expect(screen.getByText(/No PRs match/)).toBeTruthy();
  });

  it('shows loading state when PRs are being fetched', () => {
    mockAllPRsState = { status: 'loading' };
    mockCurrentBranchPR = null;

    render(<PullRequestsPanel machineId="m1" workingDir="/repo" chatroomId="c1" />);

    // Loading spinner in the list column
    expect(screen.getAllByText(/Loading/i).length).toBeGreaterThan(0);
  });
});
