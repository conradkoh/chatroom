import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DirectHarnessPanel } from './DirectHarnessPanel';

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

const mockActiveWorkspace = vi.fn();
vi.mock('../hooks/useChatroomActiveWorkspace', () => ({
  useChatroomActiveWorkspace: () => mockActiveWorkspace(),
}));

const mockSessions = vi.fn();
vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mockSessions(),
  useSessionMutation: () => vi.fn(),
  useSessionId: () => ['session-1'],
}));

vi.mock('../direct-harness/hooks/useRefreshCapabilities', () => ({
  useRefreshCapabilities: () => ({ refresh: vi.fn() }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { web: { directHarness: { sessions: { listSessions: 'listSessions' } } } },
}));

vi.mock('../direct-harness/components/SessionComposer', () => ({
  NewSessionComposer: () => <div data-testid="new-session-composer">NewSessionComposer</div>,
}));

vi.mock('../direct-harness/components/SessionDetail', () => ({
  SessionDetail: () => <div data-testid="session-detail">SessionDetail</div>,
}));

vi.mock('../direct-harness/components/SessionList', () => ({
  displaySessionTitle: (s: { sessionTitle?: string }) => s.sessionTitle ?? 'session',
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

const CHATROOM_ID = 'cr1' as never;
const NOOP_SETTER = () => {};

beforeEach(() => {
  localStorage.clear();
  mockSessions.mockReturnValue([]);
  mockUseIsDesktop.mockReturnValue(true);
});

describe('DirectHarnessPanel', () => {
  it('shows empty state when no active workspace', () => {
    mockActiveWorkspace.mockReturnValue({ activeWorkspace: null, workspaces: [] });
    render(
      <DirectHarnessPanel
        chatroomId={CHATROOM_ID}
        selectedSessionId={null}
        setSelectedSessionId={NOOP_SETTER}
      />
    );
    expect(screen.getByText(/no workspace registered/i)).toBeInTheDocument();
  });

  it('shows new session composer when workspace exists and no sessions', () => {
    mockActiveWorkspace.mockReturnValue({
      activeWorkspace: {
        workspaceId: 'ws1',
        machineId: 'm1',
        workingDir: '/proj',
        hostname: 'box',
      },
      workspaces: [],
    });
    mockSessions.mockReturnValue([]);
    render(
      <DirectHarnessPanel
        chatroomId={CHATROOM_ID}
        selectedSessionId={null}
        setSelectedSessionId={NOOP_SETTER}
      />
    );
    expect(screen.getByTestId('new-session-composer')).toBeInTheDocument();
  });

  it('shows session detail when a session is provided', () => {
    const sessionId = 'sess-1';

    mockActiveWorkspace.mockReturnValue({
      activeWorkspace: {
        workspaceId: 'ws1',
        machineId: 'm1',
        workingDir: '/proj',
        hostname: 'box',
      },
      workspaces: [],
    });

    const fakeSummary = {
      _id: sessionId,
      status: 'active',
      harnessName: 'opencode-sdk',
      lastUsedConfig: { agent: 'build' },
      sessionTitle: 'My session',
      lastActiveAt: Date.now(),
      workspaceId: 'ws1',
    };
    mockSessions.mockReturnValue([fakeSummary]);

    render(
      <DirectHarnessPanel
        chatroomId={CHATROOM_ID}
        selectedSessionId={sessionId}
        setSelectedSessionId={NOOP_SETTER}
      />
    );
    expect(screen.getByTestId('session-detail')).toBeInTheDocument();
  });

  it('opens session picker and selecting "+ New session" calls setter with null', () => {
    mockActiveWorkspace.mockReturnValue({
      activeWorkspace: {
        workspaceId: 'ws1',
        machineId: 'm1',
        workingDir: '/proj',
        hostname: 'box',
      },
      workspaces: [],
    });

    const fakeSummary = {
      _id: 'sess-1',
      status: 'active',
      harnessName: 'opencode-sdk',
      lastUsedConfig: { agent: 'build' },
      sessionTitle: 'My session',
      lastActiveAt: Date.now(),
      workspaceId: 'ws1',
    };
    mockSessions.mockReturnValue([fakeSummary]);

    const setSelectedSessionId = vi.fn();
    render(
      <DirectHarnessPanel
        chatroomId={CHATROOM_ID}
        selectedSessionId="sess-1"
        setSelectedSessionId={setSelectedSessionId}
      />
    );

    const trigger = screen.getByLabelText('Change session');
    fireEvent.click(trigger);

    const newSessionOption = screen.getByText('+ New session');
    fireEvent.click(newSessionOption);

    expect(setSelectedSessionId).toHaveBeenCalledWith(null);
  });
});
