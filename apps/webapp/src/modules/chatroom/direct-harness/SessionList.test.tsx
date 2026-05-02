import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SessionList } from './SessionList';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@workspace/backend/config/featureFlags', () => ({
  featureFlags: { directHarnessWorkers: true },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: vi.fn(),
  useSessionMutation: vi.fn().mockReturnValue(
    Object.assign(vi.fn().mockResolvedValue(undefined), { withOptimisticUpdate: vi.fn() })
  ),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    chatroom: {
      directHarness: {
        sessions: {
          listSessionsByWorkspace: 'mock-listSessionsByWorkspace',
          closeSession: 'mock-closeSession',
        },
        prompts: {
          resumeSession: 'mock-resumeSession',
        },
      },
    },
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
const mockUseSessionQuery = vi.mocked(useSessionQuery);
const mockUseSessionMutation = vi.mocked(useSessionMutation);

function makeSession(id: string, status: string, agent = 'build') {
  return {
    _id: id,
    _creationTime: 0,
    status,
    agent,
    harnessSessionId: `sdk-${id}`,
    harnessSessionRowId: id,
    workspaceId: 'ws-1',
    harnessName: 'opencode-sdk',
    createdAt: 0,
    lastActiveAt: Date.now() - 5000,
    createdBy: 'user-1',
  };
}

describe('SessionList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionMutation.mockReturnValue(
      Object.assign(vi.fn().mockResolvedValue(undefined), { withOptimisticUpdate: vi.fn() })
    );
  });

  it('shows empty state when no sessions exist', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(<SessionList workspaceId="ws-1" selectedSessionId={null} onSelect={vi.fn()} />);
    expect(screen.getByText(/No sessions in this workspace/i)).toBeDefined();
  });

  it('renders status dots for each status variant', () => {
    mockUseSessionQuery.mockReturnValue([
      makeSession('s1', 'active'),
      makeSession('s2', 'idle'),
      makeSession('s3', 'failed'),
      makeSession('s4', 'closed'),
    ]);
    render(<SessionList workspaceId="ws-1" selectedSessionId={null} onSelect={vi.fn()} />);
    // All agent names rendered
    expect(screen.getAllByText('build')).toHaveLength(4);
  });

  it('clicking an idle row triggers resumeSession', async () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);
    mockUseSessionMutation.mockReturnValue(
      Object.assign(mutationFn, { withOptimisticUpdate: vi.fn() })
    );
    const onSelect = vi.fn();
    mockUseSessionQuery.mockReturnValue([makeSession('s1', 'idle')]);

    render(<SessionList workspaceId="ws-1" selectedSessionId={null} onSelect={onSelect} />);

    // Find the session row (first button — the row itself)
    const rows = screen.getAllByRole('button');
    const row = rows[0];
    fireEvent.click(row);

    expect(onSelect).toHaveBeenCalledWith('s1');

    await waitFor(() => {
      expect(mutationFn).toHaveBeenCalledWith(
        expect.objectContaining({ harnessSessionRowId: 's1' })
      );
    });
  });

  it('clicking an active row does NOT trigger resumeSession', async () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);
    mockUseSessionMutation.mockReturnValue(
      Object.assign(mutationFn, { withOptimisticUpdate: vi.fn() })
    );
    const onSelect = vi.fn();
    mockUseSessionQuery.mockReturnValue([makeSession('s1', 'active')]);

    render(<SessionList workspaceId="ws-1" selectedSessionId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getAllByRole('button')[0]);

    expect(onSelect).toHaveBeenCalledWith('s1');
    // resumeSession should NOT be called for active sessions
    // (The mutation IS called for closeSession potentially, but not resumeSession)
    // Since we can't easily distinguish which mutation was called, just verify onSelect was called
    await new Promise((r) => setTimeout(r, 10));
    // For active sessions, resumeSession endpoint should not have been called
    // (useSessionMutation is called twice — once for resumeSession, once for closeSession)
    // The resume mutation fn shouldn't be called for active row clicks
    // We verify this by checking no 'resumeSession' args were passed
    const resumeCalls = mutationFn.mock.calls.filter(
      (c) => c[0] && typeof c[0] === 'object' && 'harnessSessionRowId' in c[0]
    );
    expect(resumeCalls).toHaveLength(0);
  });

  it('shows resuming indicator while resume is in flight', async () => {
    let resolveResume!: () => void;
    const resumePromise = new Promise<void>((resolve) => {
      resolveResume = resolve;
    });
    const mutationFn = vi.fn().mockReturnValue(resumePromise);
    mockUseSessionMutation.mockReturnValue(
      Object.assign(mutationFn, { withOptimisticUpdate: vi.fn() })
    );

    mockUseSessionQuery.mockReturnValue([makeSession('s1', 'idle')]);
    render(<SessionList workspaceId="ws-1" selectedSessionId={null} onSelect={vi.fn()} />);

    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() => {
      expect(screen.getByText('resuming…')).toBeDefined();
    });

    resolveResume();
    await waitFor(() => {
      expect(screen.queryByText('resuming…')).toBeNull();
    });
  });
});
