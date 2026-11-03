import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildScheduleFields } from '../features/scheduled-prompts/utils/scheduledPromptFields';
import { utcMsToLocalDateTimeInput } from '../features/scheduled-prompts/utils/scheduledPromptTimezone';

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
  Button: ({ children, onClick, disabled, className, title }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} title={title}>
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

const desktopMock = vi.hoisted(() => ({ value: false }));
vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => desktopMock.value,
}));

vi.mock('../features/scheduled-prompts/components/ScheduledPromptCard', () => {
  const React = require('react');
  return {
    ScheduledPromptCard: ({ prompt, setEnabled, onEdit }: any) => {
      const [actionsOpen, setActionsOpen] = React.useState(false);
      const isArchiveDisabled = prompt.disabledReason === 'archive';
      const isActive = prompt.disabledReason === undefined;
      const displayName = prompt.name || prompt.prompt.slice(0, 60);
      const isDesktop = desktopMock.value;

      return React.createElement(
        'div',
        {
          'data-testid': 'scheduled-prompt-card',
          onClick: () => !isArchiveDisabled && setActionsOpen(true),
        },
        React.createElement('span', null, displayName),
        React.createElement(
          'span',
          null,
          isActive
            ? 'Active'
            : prompt.disabledReason === 'archive'
              ? 'Disabled by archive'
              : 'Disabled'
        ),
        React.createElement(
          'span',
          { 'data-testid': 'schedule-text' },
          prompt.scheduleKind === 'interval'
            ? prompt.intervalMinutes === 1
              ? 'Every minute'
              : `Every ${prompt.intervalMinutes} minutes`
            : 'Daily schedule'
        ),
        React.createElement('input', {
          type: 'checkbox',
          role: 'switch',
          checked: isActive,
          disabled: isArchiveDisabled,
          onChange: (e: any) => {
            if (e.target.checked !== isActive) {
              setEnabled({ scheduledPromptId: prompt._id, enabled: e.target.checked });
            }
          },
          onClick: (e: any) => e.stopPropagation(),
          'data-testid': 'switch',
        }),
        actionsOpen &&
          !isArchiveDisabled &&
          (isDesktop
            ? React.createElement(
                'div',
                { 'data-testid': 'popover-content' },
                React.createElement(
                  'button',
                  { type: 'button', onClick: () => onEdit(prompt._id) },
                  'Edit'
                )
              )
            : React.createElement(
                'div',
                { 'data-testid': 'drawer-content' },
                React.createElement(
                  'button',
                  { type: 'button', onClick: () => onEdit(prompt._id) },
                  'Edit'
                )
              ))
      );
    },
  };
});

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

  it('shows popover on desktop when card is tapped', async () => {
    desktopMock.value = true;

    mocks.list.mockReturnValue([PROMPT_ACTIVE]);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('scheduled-prompt-card')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('scheduled-prompt-card'));
    await waitFor(() => {
      expect(screen.getByTestId('popover-content')).toBeDefined();
    });
    expect(screen.getByText('Edit')).toBeDefined();
  });

  it('creates a one-time prompt with the datetime-local value converted to epoch ms', async () => {
    mocks.list.mockReturnValue([]);
    mocks.create.mockResolvedValue(undefined);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByText('Add Scheduled Prompt'));
    fireEvent.click(screen.getByLabelText('One time'));
    fireEvent.change(screen.getByPlaceholderText('What should the prompt say?'), {
      target: { value: 'Ping me' },
    });

    const futureRunAt = Math.floor((Date.now() + 2 * 60 * 60_000) / 60_000) * 60_000;
    const futureValue = utcMsToLocalDateTimeInput(futureRunAt);
    const dateTimeInput = document.querySelector(
      'input[type="datetime-local"]'
    ) as HTMLInputElement;
    fireEvent.change(dateTimeInput, { target: { value: futureValue } });

    fireEvent.click(screen.getByText('Create Prompt'));

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        name: undefined,
        prompt: 'Ping me',
        scheduleKind: 'once',
        runAt: futureRunAt,
      });
    });
  });

  it('rejects a missing one-time value and does not call create', async () => {
    mocks.list.mockReturnValue([]);
    mocks.create.mockResolvedValue(undefined);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByText('Add Scheduled Prompt'));
    fireEvent.click(screen.getByLabelText('One time'));
    fireEvent.change(screen.getByPlaceholderText('What should the prompt say?'), {
      target: { value: 'No date' },
    });
    fireEvent.change(document.querySelector('input[type="datetime-local"]') as HTMLInputElement, {
      target: { value: '' },
    });

    fireEvent.click(screen.getByText('Create Prompt'));

    await waitFor(() => {
      expect(screen.getByText('Pick a date and time')).toBeDefined();
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('rejects a past one-time value and does not call create', async () => {
    mocks.list.mockReturnValue([]);
    mocks.create.mockResolvedValue(undefined);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByText('Add Scheduled Prompt'));
    fireEvent.click(screen.getByLabelText('One time'));
    fireEvent.change(screen.getByPlaceholderText('What should the prompt say?'), {
      target: { value: 'Too late' },
    });

    const pastValue = utcMsToLocalDateTimeInput(Date.now() - 60_000);
    const dateTimeInput = document.querySelector(
      'input[type="datetime-local"]'
    ) as HTMLInputElement;
    fireEvent.change(dateTimeInput, { target: { value: pastValue } });

    fireEvent.click(screen.getByText('Create Prompt'));

    await waitFor(() => {
      expect(screen.getByText('Pick a time in the future')).toBeDefined();
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('renames a past-due, user-disabled once row without a future-time error', async () => {
    desktopMock.value = true;
    const pastRunAt = Date.now() - 60 * 60_000;
    mocks.list.mockReturnValue([
      {
        ...PROMPT_ACTIVE,
        _id: 'prompt-past-once',
        name: 'Past one',
        prompt: 'Rename me',
        scheduleKind: 'once',
        hourUTC: undefined,
        minuteUTC: undefined,
        runAt: pastRunAt,
        disabledReason: 'user',
        isRunnable: false,
        nextRunAt: undefined,
      },
    ]);
    mocks.update.mockResolvedValue(undefined);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByTestId('scheduled-prompt-card'));
    fireEvent.click(await screen.findByText('Edit'));

    fireEvent.change(await screen.findByPlaceholderText('Daily Standup'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(mocks.update).toHaveBeenCalledWith({
        scheduledPromptId: 'prompt-past-once',
        name: 'Renamed',
        prompt: 'Rename me',
        scheduleKind: 'once',
        runAt: Math.floor(pastRunAt / 60_000) * 60_000,
      });
    });
    expect(screen.queryByText('Pick a time in the future')).toBeNull();
  });

  it('still rejects changing a once row to a past time', async () => {
    desktopMock.value = true;
    const futureRunAt = Date.now() + 60 * 60_000;
    mocks.list.mockReturnValue([
      {
        ...PROMPT_ACTIVE,
        _id: 'prompt-future-once',
        name: 'Future one',
        prompt: 'Keep me',
        scheduleKind: 'once',
        hourUTC: undefined,
        minuteUTC: undefined,
        runAt: futureRunAt,
        disabledReason: undefined,
        isRunnable: true,
        nextRunAt: futureRunAt,
      },
    ]);
    mocks.update.mockResolvedValue(undefined);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByTestId('scheduled-prompt-card'));
    fireEvent.click(await screen.findByText('Edit'));

    fireEvent.change(await screen.findByPlaceholderText('Daily Standup'), {
      target: { value: 'Renamed' },
    });
    fireEvent.change(document.querySelector('input[type="datetime-local"]') as HTMLInputElement, {
      target: { value: utcMsToLocalDateTimeInput(Date.now() - 60 * 60_000) },
    });
    fireEvent.click(screen.getByText('Save Changes'));

    await waitFor(() => {
      expect(screen.getByText('Pick a time in the future')).toBeDefined();
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('opens a prefilled one-time form from a composer request', async () => {
    mocks.list.mockReturnValue([]);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(
      <ScheduledPromptsTab
        chatroomId="room-1"
        pendingPrefill={{ prompt: '  Draft from composer  ', hasAttachments: true }}
      />
    );

    expect(await screen.findByText('New Scheduled Prompt')).toBeDefined();
    expect(screen.getByLabelText('One time')).toBeChecked();
    expect(screen.getByPlaceholderText('What should the prompt say?')).toHaveValue(
      '  Draft from composer  '
    );
    expect(screen.getByText('Attachments are not included in scheduled prompts.')).toBeDefined();
  });

  it('omits the attachment helper line when there are no attachments', async () => {
    mocks.list.mockReturnValue([]);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(
      <ScheduledPromptsTab
        chatroomId="room-1"
        pendingPrefill={{ prompt: 'No attachments', hasAttachments: false }}
      />
    );

    expect(await screen.findByText('New Scheduled Prompt')).toBeDefined();
    expect(screen.queryByText('Attachments are not included in scheduled prompts.')).toBeNull();
  });

  it('creates the prefilled prompt once and fires onScheduled', async () => {
    mocks.list.mockReturnValue([]);
    mocks.create.mockResolvedValue(undefined);
    const onScheduled = vi.fn();
    const onPendingPrefillCleared = vi.fn();
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(
      <ScheduledPromptsTab
        chatroomId="room-1"
        pendingPrefill={{ prompt: '  Draft from composer  ', hasAttachments: false }}
        onScheduled={onScheduled}
        onPendingPrefillCleared={onPendingPrefillCleared}
      />
    );

    fireEvent.click(await screen.findByText('Create Prompt'));

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });
    const payload = mocks.create.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      chatroomId: 'room-1',
      prompt: 'Draft from composer',
      scheduleKind: 'once',
    });
    expect(payload?.runAt).toBeGreaterThan(Date.now() + 55 * 60_000);
    expect(onScheduled).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onPendingPrefillCleared).toHaveBeenCalled());
  });

  it('does not fire onScheduled when the prefilled form is cancelled', async () => {
    mocks.list.mockReturnValue([]);
    const onScheduled = vi.fn();
    const onPendingPrefillCleared = vi.fn();
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(
      <ScheduledPromptsTab
        chatroomId="room-1"
        pendingPrefill={{ prompt: 'Keep me', hasAttachments: false }}
        onScheduled={onScheduled}
        onPendingPrefillCleared={onPendingPrefillCleared}
      />
    );

    fireEvent.click(await screen.findByText('Cancel'));

    expect(onScheduled).not.toHaveBeenCalled();
    expect(onPendingPrefillCleared).toHaveBeenCalledTimes(1);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('Cmd+Enter in the prompt field submits the form', async () => {
    mocks.list.mockReturnValue([]);
    mocks.create.mockResolvedValue(undefined);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByText('Add Scheduled Prompt'));
    fireEvent.change(screen.getByPlaceholderText('What should the prompt say?'), {
      target: { value: 'Ping me' },
    });

    fireEvent.keyDown(screen.getByPlaceholderText('What should the prompt say?'), {
      key: 'Enter',
      metaKey: true,
    });

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });
    expect(mocks.create).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      name: undefined,
      prompt: 'Ping me',
      scheduleKind: 'interval',
      intervalMinutes: 30,
    });
  });

  it('Ctrl+Enter also submits', async () => {
    mocks.list.mockReturnValue([]);
    mocks.create.mockResolvedValue(undefined);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByText('Add Scheduled Prompt'));
    fireEvent.change(screen.getByPlaceholderText('What should the prompt say?'), {
      target: { value: 'Ctrl shortcut' },
    });

    fireEvent.keyDown(screen.getByPlaceholderText('What should the prompt say?'), {
      key: 'Enter',
      ctrlKey: true,
    });

    await waitFor(() => {
      expect(mocks.create).toHaveBeenCalledTimes(1);
    });
    expect(mocks.create).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      name: undefined,
      prompt: 'Ctrl shortcut',
      scheduleKind: 'interval',
      intervalMinutes: 30,
    });
  });

  it('plain Enter does not submit', async () => {
    mocks.list.mockReturnValue([]);
    mocks.create.mockResolvedValue(undefined);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByText('Add Scheduled Prompt'));
    const promptField = screen.getByPlaceholderText('What should the prompt say?');
    fireEvent.change(promptField, { target: { value: 'No shortcut' } });

    fireEvent.keyDown(promptField, { key: 'Enter' });

    expect(mocks.create).not.toHaveBeenCalled();
    expect((promptField as HTMLTextAreaElement).value).toBe('No shortcut');
  });

  it('Cmd+Enter with an empty prompt shows the existing validation message', async () => {
    mocks.list.mockReturnValue([]);
    mocks.create.mockResolvedValue(undefined);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByText('Add Scheduled Prompt'));
    fireEvent.keyDown(screen.getByPlaceholderText('What should the prompt say?'), {
      key: 'Enter',
      metaKey: true,
    });

    await waitFor(() => {
      expect(screen.getByText('Prompt cannot be empty')).toBeDefined();
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('Cmd+Enter while saving is ignored', async () => {
    mocks.list.mockReturnValue([]);
    let resolveCreate: (() => void) | undefined;
    mocks.create.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCreate = resolve;
        })
    );
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByText('Add Scheduled Prompt'));
    const promptField = screen.getByPlaceholderText('What should the prompt say?');
    fireEvent.change(promptField, { target: { value: 'Only once' } });

    fireEvent.keyDown(promptField, { key: 'Enter', metaKey: true });
    fireEvent.keyDown(promptField, { key: 'Enter', metaKey: true });

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolveCreate?.();
      await Promise.resolve();
    });
  });

  it('the submit button advertises the shortcut', async () => {
    mocks.list.mockReturnValue([]);
    const { ScheduledPromptsTab } = await import('./ScheduledPromptsTab');
    render(<ScheduledPromptsTab chatroomId="room-1" />);

    fireEvent.click(await screen.findByText('Add Scheduled Prompt'));
    const submit = screen.getByRole('button', { name: /create prompt|save changes/i });

    expect(submit.getAttribute('title')).toContain('⌘');
    expect(submit.getAttribute('title')).toContain('Ctrl+Enter');
  });
});

describe('buildScheduleFields', () => {
  beforeAll(() => {
    vi.stubEnv('TZ', 'UTC');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  /** Now is 2023-11-14T22:13:20Z; only the daily ref date depends on it. */
  const base = { intervalMinutes: 30, hour: 9, minute: 0, now: 1_700_000_000_000 };

  it('builds a future one-time payload', () => {
    expect(buildScheduleFields('once', { ...base, runAtLocal: '2030-01-01T09:00' })).toEqual({
      data: { scheduleKind: 'once', runAt: 1893488400000 },
    });
  });

  it('rejects a past one-time payload', () => {
    expect(buildScheduleFields('once', { ...base, runAtLocal: '2020-01-01T09:00' })).toEqual({
      error: 'Pick a time in the future',
    });
  });

  it('accepts an unchanged past time when editing a one-time row', () => {
    expect(
      buildScheduleFields('once', {
        ...base,
        runAtLocal: '2020-01-01T09:00',
        initialRunAt: 1577869200000,
      })
    ).toEqual({ data: { scheduleKind: 'once', runAt: 1577869200000 } });
  });

  it('rejects an interval below the minimum', () => {
    expect(
      buildScheduleFields('interval', { ...base, intervalMinutes: 0, runAtLocal: '' })
    ).toEqual({ error: 'Interval must be at least 1 minute' });
  });

  it('rejects daily hours and minutes outside their bounds', () => {
    expect(buildScheduleFields('daily', { ...base, hour: 24, runAtLocal: '' })).toEqual({
      error: 'Daily schedule requires valid hour (0-23) and minute (0-59)',
    });
    expect(buildScheduleFields('daily', { ...base, minute: 60, runAtLocal: '' })).toEqual({
      error: 'Daily schedule requires valid hour (0-23) and minute (0-59)',
    });
  });

  it('builds daily UTC fields from the local time', () => {
    expect(buildScheduleFields('daily', { ...base, hour: 9, minute: 30, runAtLocal: '' })).toEqual({
      data: { scheduleKind: 'daily', hourUTC: 9, minuteUTC: 30 },
    });
  });
});
