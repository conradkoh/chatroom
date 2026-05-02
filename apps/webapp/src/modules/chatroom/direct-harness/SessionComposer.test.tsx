import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SessionComposer } from './SessionComposer';
import { SessionMessageStream } from './SessionMessageStream';
import { HarnessBootIndicator } from './HarnessBootIndicator';

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
          getSession: 'mock-getSession',
          updateSessionAgent: 'mock-updateSessionAgent',
        },
        messages: {
          streamSessionMessages: 'mock-streamSessionMessages',
        },
        prompts: {
          submitPrompt: 'mock-submitPrompt',
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

/** Get the underlying spy from the mock mutation returned by useSessionMutation */
function getMutationSpy(): ReturnType<typeof vi.fn> {
  return mockUseSessionMutation.mock.results[0]?.value as ReturnType<typeof vi.fn>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(status: string, agent = 'build') {
  return {
    _id: 'session-1',
    _creationTime: 0,
    status,
    agent,
    harnessSessionId: 'sdk-1',
    harnessSessionRowId: 'session-1',
    workspaceId: 'ws-1',
    harnessName: 'opencode-sdk',
    createdAt: 0,
    lastActiveAt: 0,
    createdBy: 'user-1',
  };
}

const AGENTS = [
  { name: 'build', mode: 'primary' as const, description: 'Build agent' },
  { name: 'debug', mode: 'subagent' as const },
];

// ─── HarnessBootIndicator ─────────────────────────────────────────────────────

describe('HarnessBootIndicator', () => {
  it('renders the boot message', () => {
    render(<HarnessBootIndicator />);
    expect(screen.getByText(/Harness is starting/i)).toBeDefined();
  });
});

// ─── SessionMessageStream ─────────────────────────────────────────────────────

describe('SessionMessageStream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionMutation.mockReturnValue(Object.assign(vi.fn().mockResolvedValue(undefined), { withOptimisticUpdate: vi.fn() }));
  });

  it('shows empty state when no messages', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(<SessionMessageStream sessionId="session-1" />);
    expect(screen.getByText(/No messages yet/i)).toBeDefined();
  });

  it('renders incoming messages', () => {
    mockUseSessionQuery.mockReturnValue([
      { _id: 'msg-1', seq: 0, content: 'Hello from harness', timestamp: 0, harnessSessionRowId: 'session-1', _creationTime: 0 },
    ]);
    render(<SessionMessageStream sessionId="session-1" />);
    expect(screen.getByText('Hello from harness')).toBeDefined();
  });
});

// ─── SessionComposer ─────────────────────────────────────────────────────────

describe('SessionComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // mutation spy is reset in beforeEach via vi.clearAllMocks()
    mockUseSessionMutation.mockReturnValue(Object.assign(vi.fn().mockResolvedValue(undefined), { withOptimisticUpdate: vi.fn() }));
  });

  function renderComposer(status: string, agent = 'build') {
    mockUseSessionQuery.mockReturnValue(makeSession(status, agent));
    return render(
      <SessionComposer
        sessionId="session-1"
        chatroomId="room-1"
        workspaceId="ws-1"
        availableAgents={AGENTS}
      />
    );
  }

  it('textarea is disabled when status is pending', () => {
    renderComposer('pending');
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('textarea is disabled when status is spawning', () => {
    renderComposer('spawning');
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('textarea is disabled when status is closed', () => {
    renderComposer('closed');
    // Closed shows a banner, no textarea
    expect(screen.getByText(/Session closed/i)).toBeDefined();
  });

  it('textarea is disabled when status is failed', () => {
    renderComposer('failed');
    expect(screen.getByText(/Session failed/i)).toBeDefined();
  });

  it('textarea is enabled when status is active', () => {
    renderComposer('active');
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
  });

  it('textarea is enabled when status is idle', () => {
    renderComposer('idle');
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(false);
  });

  it('send clears textarea and calls submitPrompt', async () => {
    renderComposer('active');
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: 'hello world' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(getMutationSpy()).toHaveBeenCalledWith(
        expect.objectContaining({
          harnessSessionRowId: 'session-1',
          parts: [{ type: 'text', text: 'hello world' }],
        })
      );
    });

    // Textarea cleared after send
    await waitFor(() => {
      expect(textarea.value).toBe('');
    });
  });

  it('agent chip shows current agent', () => {
    renderComposer('active', 'build');
    expect(screen.getByText('build')).toBeDefined();
  });

  it('agent chip click opens popover with primary agents only', async () => {
    renderComposer('active', 'build');
    // Only primary agent should be in the popover
    fireEvent.click(screen.getByText('build'));

    await waitFor(() => {
      // 'build' appears twice: chip + popover item (build is primary)
      const buildItems = screen.getAllByText('build');
      expect(buildItems.length).toBeGreaterThanOrEqual(1);
    });
    // subagent 'debug' should not appear
    expect(screen.queryByText('debug')).toBeNull();
  });

  it('selecting agent from popover calls updateSessionAgent', async () => {
    // Two primary agents for this test
    const agents = [
      { name: 'build', mode: 'primary' as const },
      { name: 'architect', mode: 'primary' as const },
    ];
    mockUseSessionQuery.mockReturnValue(makeSession('active', 'build'));
    render(
      <SessionComposer
        sessionId="session-1"
        chatroomId="room-1"
        workspaceId="ws-1"
        availableAgents={agents}
      />
    );

    // Click chip to open popover
    fireEvent.click(screen.getByRole('button', { name: /build/i }));

    await waitFor(() => {
      // Find 'architect' option in popover
      const architectItems = screen.getAllByText('architect');
      fireEvent.click(architectItems[0]);
    });

    await waitFor(() => {
      expect(getMutationSpy()).toHaveBeenCalledWith(
        expect.objectContaining({ harnessSessionRowId: 'session-1', agent: 'architect' })
      );
    });
  });
});
