import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledPromptSidebarRow } from './ScheduledPromptSidebarRow';

const mocks = vi.hoisted(() => ({
  updatePolicy: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.updatePolicy,
}));

/** Today at the given local time, so the upcoming label is deterministic. */
function todayAt(hour: number, minute: number): number {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function makePrompt(
  overrides: Partial<Doc<'chatroom_scheduledPrompts'>> = {}
): Doc<'chatroom_scheduledPrompts'> {
  return {
    _id: 'sp-1' as Id<'chatroom_scheduledPrompts'>,
    _creationTime: 1,
    chatroomId: 'room-1' as Id<'chatroom_rooms'>,
    prompt: 'Summarise the backlog',
    scheduleKind: 'interval',
    intervalMinutes: 30,
    isRunnable: true,
    nextRunAt: todayAt(14, 30),
    createdBy: 'user-1' as Id<'users'>,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function renderRow(
  props: {
    prompt?: Partial<Doc<'chatroom_scheduledPrompts'>>;
    onDelete?: (id: Id<'chatroom_scheduledPrompts'>) => Promise<unknown>;
    onOpen?: () => void;
  } = {}
) {
  const onOpen = props.onOpen ?? vi.fn();
  const onDelete = props.onDelete ?? vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ScheduledPromptSidebarRow
      prompt={makePrompt(props.prompt)}
      onDelete={onDelete}
      onOpen={onOpen}
    />
  );
  return { ...view, onOpen, onDelete };
}

function rowByText(text: string): HTMLElement {
  return screen.getByText(text).closest('[role="button"]') as HTMLElement;
}

function defaultRow(): HTMLElement {
  return rowByText('Summarise the backlog');
}

function deleteButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Delete' });
}

describe('ScheduledPromptSidebarRow', () => {
  beforeEach(() => {
    mocks.updatePolicy.mockReset();
    mocks.updatePolicy.mockResolvedValue(undefined);
  });

  it('shows the name when present, otherwise the prompt text', () => {
    const { unmount } = renderRow({ prompt: { name: 'Daily standup' } });
    expect(screen.getByText('Daily standup')).toBeDefined();
    unmount();

    renderRow({ prompt: { prompt: 'Fallback prompt text' } });
    expect(screen.getByText('Fallback prompt text')).toBeDefined();
  });

  it('shows the schedule and the upcoming run on the meta line', () => {
    renderRow();
    expect(screen.getByText('Every 30 minutes · Today 14:30')).toBeDefined();
  });

  it('flips only the session policy on a legacy row', () => {
    renderRow();
    const session = screen.getByRole('button', { name: 'Start in new session' });
    expect(session).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(session);

    expect(mocks.updatePolicy).toHaveBeenCalledTimes(1);
    expect(mocks.updatePolicy).toHaveBeenCalledWith({
      scheduledPromptId: 'sp-1',
      sessionPolicy: 'continue',
    });
  });

  it('flips only the session policy on a row with an explicit envelope', () => {
    renderRow({
      prompt: {
        taskEnvelope: {
          version: 1,
          conversationMode: 'chat',
          sessionPolicy: 'continue',
          handoffWorkflow: { preset: 'direct', phase: 'entry' },
        },
      },
    });
    const session = screen.getByRole('button', { name: 'Start in new session' });
    expect(session).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(session);

    expect(mocks.updatePolicy).toHaveBeenCalledWith({
      scheduledPromptId: 'sp-1',
      sessionPolicy: 'new',
    });
  });

  it('cycles only the conversation mode', () => {
    renderRow();
    const mode = screen.getByRole('button', { name: 'Mode: Code' });

    fireEvent.click(mode);

    expect(mocks.updatePolicy).toHaveBeenCalledTimes(1);
    expect(mocks.updatePolicy).toHaveBeenCalledWith({
      scheduledPromptId: 'sp-1',
      conversationMode: 'chat',
    });
  });

  it('disables the policy controls while a write is pending and re-enables after', async () => {
    let resolveUpdate: (() => void) | undefined;
    mocks.updatePolicy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveUpdate = resolve;
        })
    );
    renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Mode: Code' }));

    const session = screen.getByRole('button', { name: 'Start in new session' });
    const mode = screen.getByRole('button', { name: 'Mode: Code' });
    for (const button of [session, mode]) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
    }

    await act(async () => {
      resolveUpdate?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(mode).not.toBeDisabled());
    expect(session).not.toBeDisabled();
  });

  it.each([
    ['SCHEDULE_FINISHED', 'This prompt has already run.'],
    ['LIFECYCLE_DISABLED', "This prompt is archived and can't be changed."],
    ['NOT_FOUND', 'This prompt was deleted.'],
    ['NOTHING_TO_UPDATE', 'Could not update the schedule. Try again.'],
  ])('maps %s to its inline message', async (code, message) => {
    mocks.updatePolicy.mockRejectedValueOnce({ data: { code, message: 'ignored' } });
    renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Mode: Code' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
  });

  it('falls back for a plain Error and retries on the next press', async () => {
    mocks.updatePolicy.mockRejectedValueOnce(new Error('boom'));
    renderRow();
    const mode = screen.getByRole('button', { name: 'Mode: Code' });

    fireEvent.click(mode);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not update the schedule. Try again.'
    );

    fireEvent.click(mode);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(mocks.updatePolicy).toHaveBeenCalledTimes(2);
  });

  it('does not open the detail from a click or key press on a control', () => {
    const { onOpen } = renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Start in new session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mode: Code' }));
    fireEvent.click(deleteButton());
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mode: Code' }), { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mode: Code' }), { key: ' ' });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the detail from the row, Enter and Space', () => {
    const { onOpen } = renderRow();

    fireEvent.click(defaultRow());
    fireEvent.keyDown(defaultRow(), { key: 'Enter' });
    fireEvent.keyDown(defaultRow(), { key: ' ' });

    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('deletes on a single tap without arming', () => {
    const { onDelete } = renderRow();

    fireEvent.click(deleteButton());

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith('sp-1');
    expect(mocks.updatePolicy).not.toHaveBeenCalled();
  });

  it('disables the delete control while it is in flight and ignores extra taps', async () => {
    let resolveDelete: (() => void) | undefined;
    const onDelete = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = resolve;
        })
    );
    renderRow({ onDelete });

    fireEvent.click(deleteButton());

    expect(deleteButton()).toBeDisabled();
    expect(deleteButton()).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(deleteButton());
    expect(onDelete).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveDelete?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(deleteButton()).not.toBeDisabled());
  });

  it('maps a delete failure inline', async () => {
    const onDelete = vi.fn().mockRejectedValue({ data: { code: 'NOT_FOUND' } });
    renderRow({ onDelete });

    fireEvent.click(deleteButton());

    expect(await screen.findByTestId('scheduled-prompt-sidebar-error')).toHaveTextContent(
      'This prompt was deleted.'
    );
  });

  it('exposes the shared policy controls scoped to the row', () => {
    renderRow();
    const row = defaultRow();

    expect(row.querySelector('[data-testid="scheduled-prompt-session-toggle"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="scheduled-prompt-mode-toggle"]')).not.toBeNull();
    expect(deleteButton()).toBeDefined();
  });
});
