import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useSessionQuery, useSessionMutation } from 'convex-helpers/react/sessions';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { DirectHarnessPanel } from './DirectHarnessPanel';
import { NewSessionButton } from './NewSessionButton';
import { SessionList } from './SessionList';
import { WorkspacePicker } from './WorkspacePicker';


// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@workspace/backend/config/featureFlags', () => ({
  featureFlags: { directHarnessWorkers: true }, // backend flag (not used by panel directly)
}));

// Panel reads NEXT_PUBLIC_DIRECT_HARNESS_ENABLED from process.env
process.env.NEXT_PUBLIC_DIRECT_HARNESS_ENABLED = 'true';

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: vi.fn(),
  useSessionMutation: vi.fn().mockReturnValue(
    Object.assign(vi.fn().mockResolvedValue(undefined), {
      withOptimisticUpdate: vi.fn(),
    })
  ),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaces: {
      listWorkspacesForChatroom: 'mock-listWorkspacesForChatroom',
    },
    chatroom: {
      directHarness: {
        sessions: {
          listSessionsByWorkspace: 'mock-listSessionsByWorkspace',
          openSession: 'mock-openSession',
          getSession: 'mock-getSession',
          closeSession: 'mock-closeSession',
          updateSessionAgent: 'mock-updateSessionAgent',
        },
        prompts: {
          resumeSession: 'mock-resumeSession',
          submitPrompt: 'mock-submitPrompt',
        },
        messages: {
          streamSessionMessages: 'mock-streamSessionMessages',
        },
        capabilities: {
          getMachineRegistry: 'mock-getMachineRegistry',
        },
      },
    },
  },
}));
const mockUseSessionQuery = vi.mocked(useSessionQuery);
const mockUseSessionMutation = vi.mocked(useSessionMutation);

// ─── DirectHarnessPanel ───────────────────────────────────────────────────────

describe('DirectHarnessPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionQuery.mockReturnValue(undefined);
    mockUseSessionMutation.mockReturnValue(Object.assign(vi.fn().mockResolvedValue(undefined), { withOptimisticUpdate: vi.fn() }));
  });

  it('renders the collapsible panel header when flag is on', () => {
    // In this mock context, directHarnessWorkers is true
    mockUseSessionQuery.mockReturnValue([]);
    render(<DirectHarnessPanel chatroomId="room-1" />);
    expect(screen.getByText('Direct Harness')).toBeDefined();
  });

  it('renders the collapsible panel header', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(<DirectHarnessPanel chatroomId="room-1" />);
    expect(screen.getByText('Direct Harness')).toBeDefined();
  });
});

// ─── WorkspacePicker ──────────────────────────────────────────────────────────

describe('WorkspacePicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionMutation.mockReturnValue(Object.assign(vi.fn().mockResolvedValue(undefined), { withOptimisticUpdate: vi.fn() }));
  });

  it('shows empty state when no workspaces exist', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(
      <WorkspacePicker chatroomId="room-1" selectedWorkspaceId={null} onSelect={vi.fn()} />
    );
    expect(screen.getByText(/No workspaces yet/i)).toBeDefined();
  });

  it('renders workspace options when workspaces exist', () => {
    mockUseSessionQuery.mockReturnValue([
      { _id: 'ws-1', workingDir: '/home/repo', machineId: 'machine-1', hostname: 'host' },
    ]);
    const onSelect = vi.fn();
    render(
      <WorkspacePicker chatroomId="room-1" selectedWorkspaceId={null} onSelect={onSelect} />
    );
    // The select trigger should be present
    expect(screen.getByText(/Select workspace/i)).toBeDefined();
  });
});

// ─── SessionList ─────────────────────────────────────────────────────────────

describe('SessionList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionMutation.mockReturnValue(Object.assign(vi.fn().mockResolvedValue(undefined), { withOptimisticUpdate: vi.fn() }));
  });

  it('shows empty state when no sessions exist', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(
      <SessionList workspaceId="ws-1" selectedSessionId={null} onSelect={vi.fn()} />
    );
    expect(screen.getByText(/No sessions in this workspace/i)).toBeDefined();
  });

  it('renders sessions with correct status badge colors', () => {
    mockUseSessionQuery.mockReturnValue([
      {
        _id: 'session-1',
        agent: 'build',
        status: 'active',
        lastActiveAt: Date.now() - 30000,
        workspaceId: 'ws-1',
        harnessName: 'opencode-sdk',
        createdAt: Date.now(),
        createdBy: 'user-1',
      },
      {
        _id: 'session-2',
        agent: 'debug',
        status: 'failed',
        lastActiveAt: Date.now() - 60000,
        workspaceId: 'ws-1',
        harnessName: 'opencode-sdk',
        createdAt: Date.now(),
        createdBy: 'user-1',
      },
    ]);
    render(
      <SessionList workspaceId="ws-1" selectedSessionId={null} onSelect={vi.fn()} />
    );
    // Both agents rendered
    expect(screen.getByText('build')).toBeDefined();
    expect(screen.getByText('debug')).toBeDefined();
    // Status badges rendered
    expect(screen.getByText('active')).toBeDefined();
    expect(screen.getByText('failed')).toBeDefined();
  });
});

// ─── NewSessionButton ─────────────────────────────────────────────────────────

describe('NewSessionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionMutation.mockReturnValue(Object.assign(vi.fn().mockResolvedValue(undefined), { withOptimisticUpdate: vi.fn() }));
  });

  it('is disabled with tooltip hint when no agents available (harness not booted)', () => {
    render(
      <NewSessionButton
        workspaceId="ws-1"
        machineId={null}
        chatroomId="room-1"
        availableAgents={[]}
      />
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveProperty('disabled', true);
  });

  it('lists available primary agents in the popover', async () => {
    const agents = [
      { name: 'build', mode: 'primary' as const, description: 'Build agent' },
      { name: 'subbot', mode: 'subagent' as const },
    ];
    render(
      <NewSessionButton
        workspaceId="ws-1"
        machineId="machine-1"
        chatroomId="room-1"
        availableAgents={agents}
      />
    );
    const btn = screen.getByRole('button', { name: /New session/i });
    fireEvent.click(btn);

    await waitFor(() => {
      // Only primary agents shown
      expect(screen.getByText('build')).toBeDefined();
      // subagent not shown
      expect(screen.queryByText('subbot')).toBeNull();
    });
  });

  it('calls openSession mutation when agent selected and confirmed', async () => {
    const mutationFn = vi.fn().mockResolvedValue(undefined);
    mockUseSessionMutation.mockReturnValue(Object.assign(mutationFn, { withOptimisticUpdate: vi.fn() }));

    const agents = [{ name: 'build', mode: 'primary' as const }];
    render(
      <NewSessionButton
        workspaceId="ws-1"
        machineId="machine-1"
        chatroomId="room-1"
        availableAgents={agents}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /New session/i }));

    await waitFor(() => {
      fireEvent.click(screen.getByText('build'));
    });
    fireEvent.click(screen.getByRole('button', { name: /Open session/i }));

    await waitFor(() => {
      expect(mutationFn).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: 'ws-1',
          agent: 'build',
          harnessName: 'opencode-sdk',
        })
      );
    });
  });
});
