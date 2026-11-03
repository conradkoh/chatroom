import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    deleteArmed?: boolean;
    onRequestDelete?: (id: Id<'chatroom_scheduledPrompts'>) => void | Promise<void>;
    onOpen?: () => void;
  } = {}
) {
  const onOpen = props.onOpen ?? vi.fn();
  const onRequestDelete = props.onRequestDelete ?? vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ScheduledPromptSidebarRow
      prompt={makePrompt(props.prompt)}
      deleteArmed={props.deleteArmed ?? false}
      onRequestDelete={onRequestDelete}
      onOpen={onOpen}
    />
  );
  return { ...view, onOpen, onRequestDelete };
}

function row(): HTMLElement {
  return screen.getByTestId('scheduled-prompt-sidebar-row');
}

describe('ScheduledPromptSidebarRow', () => {
  beforeEach(() => {
    mocks.updatePolicy.mockReset();
    mocks.updatePolicy.mockResolvedValue(undefined);
  });

  it('shows the name when present, otherwise the prompt text', () => {
    const { unmount } = renderRow({ prompt: { name: 'Daily standup' } });
    expect(screen.getByText('Daily standup')).toHaveAttribute('title', 'Daily standup');
    unmount();

    renderRow({ prompt: { prompt: 'Fallback prompt text' } });
    expect(screen.getByText('Fallback prompt text')).toHaveAttribute(
      'title',
      'Fallback prompt text'
    );
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
      conversationMode: 'code:enhanced',
    });
  });

  it('disables every control while a call is pending and re-enables after', async () => {
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
    const del = screen.getByRole('button', { name: 'Delete Summarise the backlog' });
    for (const button of [session, mode, del]) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-busy', 'true');
    }

    await act(async () => {
      resolveUpdate?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(mode).not.toBeDisabled());
    expect(session).not.toBeDisabled();
    expect(del).not.toBeDisabled();
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

  it('does not open the detail dialog from the control cluster', () => {
    const { onOpen } = renderRow();

    fireEvent.click(screen.getByRole('button', { name: 'Start in new session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mode: Code' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Summarise the backlog' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mode: Code' }), { key: 'Enter' });

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the detail dialog from the row, Enter and Space', () => {
    const { onOpen } = renderRow();

    fireEvent.click(row());
    fireEvent.keyDown(row(), { key: 'Enter' });
    fireEvent.keyDown(row(), { key: ' ' });

    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it('arms delete on the first click without deleting', () => {
    const { onRequestDelete } = renderRow();
    const del = screen.getByRole('button', { name: 'Delete Summarise the backlog' });

    fireEvent.click(del);

    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect(onRequestDelete).toHaveBeenCalledWith('sp-1');
    expect(mocks.updatePolicy).not.toHaveBeenCalled();
  });

  it('runs the delete path and shows the armed styling when armed', async () => {
    const onRequestDelete = vi.fn().mockResolvedValue(undefined);
    renderRow({ deleteArmed: true, onRequestDelete });
    const del = screen.getByRole('button', {
      name: 'Confirm delete Summarise the backlog',
    });
    expect(del).toHaveAttribute('title', 'Click again to delete');
    expect(del).toHaveClass('bg-red-600');

    await act(async () => {
      fireEvent.click(del);
    });

    expect(onRequestDelete).toHaveBeenCalledWith('sp-1');
    expect(mocks.updatePolicy).not.toHaveBeenCalled();
  });

  it('maps a delete failure inline', async () => {
    const onRequestDelete = vi.fn().mockRejectedValue({ data: { code: 'NOT_FOUND' } });
    renderRow({ deleteArmed: true, onRequestDelete });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Summarise the backlog' }));

    expect(await screen.findByTestId('scheduled-prompt-sidebar-error')).toHaveTextContent(
      'This prompt was deleted.'
    );
  });

  it('exposes a delete control scoped to the row', () => {
    renderRow();
    const cluster = within(row());
    expect(cluster.getByTestId('scheduled-prompt-session-toggle')).toBeDefined();
    expect(cluster.getByTestId('scheduled-prompt-mode-toggle')).toBeDefined();
    expect(cluster.getByTestId('scheduled-prompt-delete')).toBeDefined();
  });
});
