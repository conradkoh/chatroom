import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DirectHarnessPanel } from './DirectHarnessPanel';

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

vi.mock('../direct-harness/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-value={value}>{children}</div>
  ),
}));

import type React from 'react';

// ─── Tests ────────────────────────────────────────────────────────────────────

const CHATROOM_ID = 'cr1' as never;

beforeEach(() => {
  localStorage.clear();
  mockSessions.mockReturnValue([]);
});

describe('DirectHarnessPanel', () => {
  it('shows empty state when no active workspace', () => {
    mockActiveWorkspace.mockReturnValue({ activeWorkspace: null, workspaces: [] });
    render(<DirectHarnessPanel chatroomId={CHATROOM_ID} />);
    expect(screen.getByText(/no workspace registered/i)).toBeInTheDocument();
  });

  it('shows new session composer when workspace exists and no sessions', () => {
    mockActiveWorkspace.mockReturnValue({
      activeWorkspace: { workspaceId: 'ws1', machineId: 'm1', workingDir: '/proj', hostname: 'box' },
      workspaces: [],
    });
    mockSessions.mockReturnValue([]);
    render(<DirectHarnessPanel chatroomId={CHATROOM_ID} />);
    expect(screen.getByTestId('new-session-composer')).toBeInTheDocument();
  });

  it('shows session detail when a session is persisted and found', () => {
    // Pre-populate localStorage with a session ID
    const sessionId = 'sess-1';
    localStorage.setItem('chatroom:cr1:harnessPanel:selectedSessionId', sessionId);

    mockActiveWorkspace.mockReturnValue({
      activeWorkspace: { workspaceId: 'ws1', machineId: 'm1', workingDir: '/proj', hostname: 'box' },
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

    render(<DirectHarnessPanel chatroomId={CHATROOM_ID} />);
    expect(screen.getByTestId('session-detail')).toBeInTheDocument();
  });
});
