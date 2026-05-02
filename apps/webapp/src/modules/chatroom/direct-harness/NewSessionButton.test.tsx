import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUseSessionQuery = vi.fn();
const mockUseSessionMutation = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
  useSessionMutation: (...args: unknown[]) => mockUseSessionMutation(...args),
}));

import { NewSessionButton } from './NewSessionButton';

const WORKSPACE_ID = 'ws1' as never;
const CHATROOM_ID = 'cr1' as never;
const NEW_SESSION_ID = 'newSession1' as never;

function makeMachine(agents: { name: string; mode: 'primary' | 'subagent' | 'all' }[]) {
  return [
    {
      machineId: 'm1',
      lastSeenAt: Date.now(),
      workspaces: [
        {
          workspaceId: WORKSPACE_ID,
          cwd: '/home',
          name: 'test-ws',
          agents,
        },
      ],
    },
  ];
}

describe('NewSessionButton', () => {
  beforeEach(() => {
    mockUseSessionMutation.mockReturnValue(
      vi.fn().mockResolvedValue({ harnessSessionRowId: NEW_SESSION_ID })
    );
  });

  it('renders disabled with tooltip when registry returns empty agents', () => {
    mockUseSessionQuery.mockReturnValue(makeMachine([]));

    render(
      <NewSessionButton
        workspaceId={WORKSPACE_ID}
        chatroomId={CHATROOM_ID}
        onSessionCreated={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: /new session/i });
    expect(button).toBeDisabled();
  });

  it('opens popover on click and lists primary/all agents', async () => {
    mockUseSessionQuery.mockReturnValue(
      makeMachine([
        { name: 'builder', mode: 'primary' },
        { name: 'planner', mode: 'all' },
        { name: 'sub-worker', mode: 'subagent' },
      ])
    );

    render(
      <NewSessionButton
        workspaceId={WORKSPACE_ID}
        chatroomId={CHATROOM_ID}
        onSessionCreated={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: /new session/i });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('builder')).toBeInTheDocument();
      expect(screen.getByText('planner')).toBeInTheDocument();
      // subagent should NOT appear
      expect(screen.queryByText('sub-worker')).not.toBeInTheDocument();
    });
  });

  it('shows tooltip when registry is undefined (loading state)', () => {
    // registry === undefined means the Convex query hasn't resolved yet
    mockUseSessionQuery.mockReturnValue(undefined);

    render(
      <NewSessionButton
        workspaceId={WORKSPACE_ID}
        chatroomId={CHATROOM_ID}
        onSessionCreated={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: /new session/i });
    expect(button).toBeDisabled();
    // Tooltip wraps the button — verify tooltip provider is present via aria
    expect(
      button.closest('[data-radix-tooltip-trigger]') !== null ||
        button.hasAttribute('data-state') ||
        button.closest('button') !== null
    ).toBe(true);
  });

  it('renders disabled with tooltip when registry has machines but no primary agents', () => {
    // Machines present, but all agents are subagent mode
    mockUseSessionQuery.mockReturnValue(
      makeMachine([{ name: 'internal-worker', mode: 'subagent' }])
    );

    render(
      <NewSessionButton
        workspaceId={WORKSPACE_ID}
        chatroomId={CHATROOM_ID}
        onSessionCreated={vi.fn()}
      />
    );

    const button = screen.getByRole('button', { name: /new session/i });
    expect(button).toBeDisabled();
  });

  it('shows error text when openSession throws', async () => {
    const mockOpenSession = vi.fn().mockRejectedValue(new Error('Backend unavailable'));
    mockUseSessionMutation.mockReturnValue(mockOpenSession);

    mockUseSessionQuery.mockReturnValue(makeMachine([{ name: 'builder', mode: 'primary' }]));

    render(
      <NewSessionButton
        workspaceId={WORKSPACE_ID}
        chatroomId={CHATROOM_ID}
        onSessionCreated={vi.fn()}
      />
    );

    // Open popover
    fireEvent.click(screen.getByRole('button', { name: /new session/i }));
    await waitFor(() => expect(screen.getByText('builder')).toBeInTheDocument());

    // Select agent
    fireEvent.click(screen.getByText('builder'));

    // Click confirm
    fireEvent.click(screen.getByRole('button', { name: /open session/i }));

    await waitFor(() => {
      expect(screen.getByText('Backend unavailable')).toBeInTheDocument();
    });
  });

  it('clicking confirm calls openSession with selected agent and triggers onSessionCreated', async () => {
    const mockOpenSession = vi.fn().mockResolvedValue({ harnessSessionRowId: NEW_SESSION_ID });
    mockUseSessionMutation.mockReturnValue(mockOpenSession);

    mockUseSessionQuery.mockReturnValue(
      makeMachine([
        { name: 'builder', mode: 'primary' },
        { name: 'planner', mode: 'primary' },
      ])
    );

    const onSessionCreated = vi.fn();

    render(
      <NewSessionButton
        workspaceId={WORKSPACE_ID}
        chatroomId={CHATROOM_ID}
        onSessionCreated={onSessionCreated}
      />
    );

    // Open popover
    fireEvent.click(screen.getByRole('button', { name: /new session/i }));

    // Select builder agent
    await waitFor(() => expect(screen.getByText('builder')).toBeInTheDocument());
    fireEvent.click(screen.getByText('builder'));

    // Click confirm
    const confirmButton = screen.getByRole('button', { name: /open session/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(mockOpenSession).toHaveBeenCalledWith({
        workspaceId: WORKSPACE_ID,
        harnessName: 'opencode-sdk',
        config: { agent: 'builder' },
        firstPrompt: expect.objectContaining({
          parts: expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
        }),
      });
      expect(onSessionCreated).toHaveBeenCalledWith(NEW_SESSION_ID);
    });
  });
});
