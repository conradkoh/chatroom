import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  setEnabled: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (_query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    return mocks.list();
  },
  useSessionMutation: (mutation: unknown) => {
    const name = String(mutation).split('.').pop();
    if (name === 'create') return mocks.create;
    if (name === 'update') return mocks.update;
    if (name === 'setEnabled') return mocks.setEnabled;
    if (name === 'remove') return mocks.remove;
    return vi.fn();
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    scheduledPrompts: {
      list: 'scheduledPrompts.list',
      create: 'scheduledPrompts.create',
      update: 'scheduledPrompts.update',
      setEnabled: 'scheduledPrompts.setEnabled',
      remove: 'scheduledPrompts.remove',
    },
  },
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className }: any) => (
    <button onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, disabled, onClick }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => {
        onCheckedChange?.(e.target.checked);
      }}
      disabled={disabled}
      onClick={onClick}
      role="switch"
      data-testid="switch"
    />
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: ({ value, onChange, placeholder, className, type, min, max }: any) => (
    <input
      type={type || 'text'}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      min={min}
      max={max}
      className={className}
    />
  ),
}));

vi.mock('@/components/ui/drawer', () => ({
  Drawer: ({ children, open }: any) => (open ? <div data-testid="drawer">{children}</div> : null),
  DrawerContent: ({ children }: any) => <div data-testid="drawer-content">{children}</div>,
  DrawerHeader: ({ children }: any) => <div>{children}</div>,
  DrawerTitle: ({ children }: any) => <div>{children}</div>,
  DrawerFooter: ({ children }: any) => <div>{children}</div>,
  DrawerClose: ({ children }: any) => <div>{children}</div>,
}));

const PROMPT_ACTIVE = {
  _id: 'prompt-1',
  chatroomId: 'room-1',
  name: 'Daily Standup',
  prompt: 'What did you work on?',
  scheduleKind: 'daily',
  hourUTC: 9,
  minuteUTC: 0,
  disabledReason: undefined,
  isRunnable: true,
  nextRunAt: Date.now() + 3600000,
  lastRunAt: Date.now() - 86400000,
};

const PROMPT_ARCHIVE = {
  ...PROMPT_ACTIVE,
  _id: 'prompt-2',
  name: 'Archived',
  disabledReason: 'archive',
  isRunnable: false,
  nextRunAt: undefined,
};

const PROMPT_USER_DISABLED = {
  ...PROMPT_ACTIVE,
  _id: 'prompt-3',
  name: 'Paused',
  disabledReason: 'user',
  isRunnable: false,
  nextRunAt: undefined,
};

describe('ScheduledPromptsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows empty state with add CTA when no prompts', async () => {
    mocks.list.mockReturnValue([]);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    await waitFor(() => {
      expect(screen.getByText('No scheduled prompts')).toBeDefined();
    });
    expect(screen.getByText('Add Scheduled Prompt')).toBeDefined();
  });

  it('renders list when prompts returned', async () => {
    mocks.list.mockReturnValue([PROMPT_ACTIVE, PROMPT_ARCHIVE, PROMPT_USER_DISABLED]);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    await waitFor(() => {
      expect(screen.getByText('Daily Standup')).toBeDefined();
      expect(screen.getByText('Archived')).toBeDefined();
      expect(screen.getByText('Paused')).toBeDefined();
    });
  });

  it('toggle calls setEnabled with enabled: false when Switch unchecked', async () => {
    mocks.list.mockReturnValue([PROMPT_ACTIVE]);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    await waitFor(() => {
      expect(screen.getByRole('switch')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => {
      expect(mocks.setEnabled).toHaveBeenCalledWith({
        scheduledPromptId: 'prompt-1',
        enabled: false,
      });
    });
  });

  it('archive-disabled row has disabled Switch and shows Disabled by archive badge', async () => {
    mocks.list.mockReturnValue([PROMPT_ARCHIVE]);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    await waitFor(() => {
      expect(screen.getByText('Disabled by archive')).toBeDefined();
    });

    const switchEl = screen.getByRole('switch') as HTMLInputElement;
    expect(switchEl.disabled).toBe(true);
  });

  it('shows singular interval text for 1-minute prompts', async () => {
    const intervalPrompt = {
      ...PROMPT_ACTIVE,
      _id: 'prompt-4',
      scheduleKind: 'interval' as const,
      intervalMinutes: 1,
    };
    mocks.list.mockReturnValue([intervalPrompt]);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    await waitFor(() => {
      expect(screen.getByText('Every minute')).toBeDefined();
    });
  });
});
