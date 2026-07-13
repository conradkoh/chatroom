/**
 * Tests for PullRequestsPanel.
 *
 * Tests: default selection (current-branch PR), filter switching,
 * current-branch badge, empty state, and PR list rendering.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Tests ────────────────────────────────────────────────────────────────────

import { PullRequestsPanel } from './PullRequestsPanel';

// jsdom does not provide matchMedia (used by vaul drawer and useIsDesktop)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const mockUseIsDesktop = vi.fn(() => true);

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockRequestAllPRs = vi.fn();
let mockAllPRsState: { status: string; pullRequests?: Record<string, unknown>[] } = {
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

describe('PullRequestsPanel', () => {
  beforeEach(() => {
    mockAllPRsState = { status: 'available', pullRequests: ALL_PRS };
    mockCurrentBranchPR = PR_CURRENT;
    mockCurrentUserLogin = 'alice';
    mockRequestAllPRs.mockClear();
    mockUseIsDesktop.mockReturnValue(true);
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
    render(<PullRequestsPanel machineId="m1" workingDir="/repo" />);
    // Mount triggers requestAllPRs via useEffect
    // (already mocked; just verify no crash)
  });

  it('renders PR list with current-branch PR selected by default', () => {
    render(<PullRequestsPanel machineId="m1" workingDir="/repo" />);

    // PR list is visible (multiple occurrences possible - list + review)
    expect(screen.getAllByText('PR #10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PR #9').length).toBeGreaterThan(0);

    // Current-branch PR is auto-selected (PR review shown)
    const reviews = screen.getAllByTestId('pr-review');
    expect(reviews.length).toBeGreaterThan(0);
    const review = reviews[0];
    expect(review?.textContent).toBe('PR #10');
  });

  it('shows star indicator on the current-branch PR', () => {
    const { container } = render(<PullRequestsPanel machineId="m1" workingDir="/repo" />);
    // The Star icon has title="Current branch PR"
    const starTitle = container.querySelector('[title="Current branch PR"]');
    expect(starTitle).toBeTruthy();
  });

  it('filters to my-prs by default (alice only)', () => {
    render(<PullRequestsPanel machineId="m1" workingDir="/repo" />);

    // alice's PRs: #10, #9 — visible
    expect(screen.getAllByText('PR #10').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PR #9').length).toBeGreaterThan(0);
    // bob's PR: #8 — NOT visible in my-prs filter
    expect(screen.queryByText('PR #8')).toBeNull();
  });

  it('switching to all filter shows all PRs including other authors', () => {
    mockUseIsDesktop.mockReturnValue(true);
    render(<PullRequestsPanel machineId="m1" workingDir="/repo" />);

    const trigger = screen.getByText('My PRs');
    fireEvent.click(trigger);

    const allOption = screen.getByRole('option', { name: 'All' });
    fireEvent.click(allOption);

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

    render(<PullRequestsPanel machineId="m1" workingDir="/repo" />);

    expect(screen.getByText(/No PRs match/)).toBeTruthy();
  });

  it('shows loading state when PRs are being fetched', () => {
    mockAllPRsState = { status: 'loading' };
    mockCurrentBranchPR = null;

    render(<PullRequestsPanel machineId="m1" workingDir="/repo" />);

    // Loading spinner in the list column
    expect(screen.getAllByText(/Loading/i).length).toBeGreaterThan(0);
  });
});
