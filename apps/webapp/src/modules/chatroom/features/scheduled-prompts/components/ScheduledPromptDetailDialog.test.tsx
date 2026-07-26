import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  listTriggeredMessages: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    const name = String(_query).split('.').pop();
    if (name === 'get') return mocks.get();
    if (name === 'listTriggeredMessages') return mocks.listTriggeredMessages();
    return undefined;
  },
  useSessionMutation: (_mutation: unknown) => {
    const name = String(_mutation).split('.').pop();
    if (name === 'setEnabled') return mocks.setEnabled;
    return vi.fn();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    scheduledPrompts: {
      get: 'scheduledPrompts.get',
      listTriggeredMessages: 'scheduledPrompts.listTriggeredMessages',
      setEnabled: 'scheduledPrompts.setEnabled',
    },
  },
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}));

import { ScheduledPromptDetailDialog } from './ScheduledPromptDetailDialog';

const defaultPrompt = {
  _id: 'prompt-1',
  name: 'Daily Standup',
  prompt: 'What did you do today?',
  scheduleKind: 'daily' as const,
  hourUTC: 9,
  minuteUTC: 0,
  disabledReason: undefined,
  isRunnable: true,
  lastRunAt: 1000,
  nextRunAt: 2000,
};

describe('ScheduledPromptDetailDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders schedule details and status', () => {
    mocks.get.mockReturnValue(defaultPrompt);
    mocks.listTriggeredMessages.mockReturnValue([]);

    render(
      <ScheduledPromptDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        scheduledPromptId="prompt-1"
        as
        any
      />
    );

    expect(screen.getByText('Daily Standup')).toBeInTheDocument();
    expect(screen.getByText(/Status:/)).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows trigger history list', () => {
    mocks.get.mockReturnValue(defaultPrompt);
    mocks.listTriggeredMessages.mockReturnValue([
      { _id: 'msg-1', _creationTime: 1000, content: 'triggered message' },
    ]);

    render(
      <ScheduledPromptDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        scheduledPromptId="prompt-1"
        as
        any
      />
    );

    expect(screen.getByText('triggered message')).toBeInTheDocument();
  });

  it('shows empty state when no messages triggered', () => {
    mocks.get.mockReturnValue(defaultPrompt);
    mocks.listTriggeredMessages.mockReturnValue([]);

    render(
      <ScheduledPromptDetailDialog
        open={true}
        onOpenChange={vi.fn()}
        scheduledPromptId="prompt-1"
        as
        any
      />
    );

    expect(screen.getByText('No messages triggered yet.')).toBeInTheDocument();
  });

  it('disable button calls setEnabled with enabled: false', async () => {
    mocks.get.mockReturnValue(defaultPrompt);
    mocks.listTriggeredMessages.mockReturnValue([]);
    mocks.setEnabled.mockResolvedValue(undefined);

    const onOpenChange = vi.fn();
    render(
      <ScheduledPromptDetailDialog
        open={true}
        onOpenChange={onOpenChange}
        scheduledPromptId="prompt-1"
        as
        any
      />
    );

    fireEvent.click(screen.getByText('Disable schedule'));
    await waitFor(() => {
      expect(mocks.setEnabled).toHaveBeenCalledWith({
        scheduledPromptId: 'prompt-1',
        enabled: false,
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
