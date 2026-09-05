/**
 * QueuedMessageEnvelopeControls — Unit Tests
 *
 * Verifies the shared stateless envelope editor: complete-envelope selection,
 * full mode/session option surface, legacy-scalar fallback, pending guards,
 * error mapping, and event isolation from an enclosing row.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { createTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QueuedMessageEnvelopeControls } from './QueuedMessageEnvelopeControls';
import type { Message } from '../types/message';

const { mockUpdate } = vi.hoisted(() => ({ mockUpdate: vi.fn() }));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockUpdate,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { messages: { updateQueuedMessageEnvelope: 'messages:updateQueuedMessageEnvelope' } },
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'Hello world',
    _creationTime: Date.now(),
    isQueued: true,
    ...overrides,
  };
}

function renderControls(message: Message) {
  return render(<QueuedMessageEnvelopeControls message={message} />);
}

function modeCombobox() {
  return screen.getByRole('combobox', { name: 'Queued message mode' });
}

function sessionCombobox() {
  return screen.getByRole('combobox', { name: 'Queued message session policy' });
}

async function selectModeOption(label: string) {
  const user = userEvent.setup();
  await user.click(modeCombobox());
  const option = await screen.findByRole('option', { name: label });
  await user.click(option);
}

async function selectSessionOption(label: string) {
  const user = userEvent.setup();
  await user.click(sessionCombobox());
  const option = await screen.findByRole('option', { name: label });
  await user.click(option);
}

beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
});

describe('QueuedMessageEnvelopeControls', () => {
  it('renders all mode and session options with correct initial selections', async () => {
    const envelope: TaskEnvelopeV1 = {
      version: 1,
      conversationMode: 'chat',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'direct', phase: 'entry' },
    };
    renderControls(makeMessage({ taskEnvelope: envelope }));

    expect(modeCombobox()).toHaveTextContent('Chat');
    expect(sessionCombobox()).toHaveTextContent('Continue');

    const user = userEvent.setup();
    await user.click(modeCombobox());
    expect(await screen.findByRole('option', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Code:Enhanced' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(sessionCombobox());
    expect(await screen.findByRole('option', { name: 'Continue' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'New session' })).toBeInTheDocument();
  });

  it('mode change sends one complete envelope with the new mode default workflow and preserved session policy', async () => {
    const envelope: TaskEnvelopeV1 = createTaskEnvelope({
      conversationMode: 'chat',
      sessionPolicy: 'new',
    });
    renderControls(makeMessage({ taskEnvelope: envelope }));

    await selectModeOption('Code');

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      queuedMessageId: 'msg-1' as Id<'chatroom_messageQueue'>,
      taskEnvelope: {
        version: 1,
        conversationMode: 'code',
        sessionPolicy: 'new',
        handoffWorkflow: { preset: 'team', phase: 'entry' },
      },
    });
  });

  it('session change sends one complete envelope preserving mode and current non-entry workflow', async () => {
    const envelope: TaskEnvelopeV1 = {
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'team', phase: 'implementation' },
    };
    renderControls(makeMessage({ taskEnvelope: envelope }));

    await selectSessionOption('New session');

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      queuedMessageId: 'msg-1' as Id<'chatroom_messageQueue'>,
      taskEnvelope: {
        version: 1,
        conversationMode: 'code',
        sessionPolicy: 'new',
        handoffWorkflow: { preset: 'team', phase: 'implementation' },
      },
    });
  });

  it('falls back to legacy scalar fields when no explicit envelope is present', async () => {
    renderControls(
      makeMessage({
        taskEnvelope: undefined,
        conversationMode: 'chat',
        plannerEnhancerEnabled: false,
        startInNewSession: true,
      })
    );

    expect(modeCombobox()).toHaveTextContent('Chat');
    expect(sessionCombobox()).toHaveTextContent('New session');

    await selectModeOption('Code');

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      queuedMessageId: 'msg-1' as Id<'chatroom_messageQueue'>,
      taskEnvelope: {
        version: 1,
        conversationMode: 'code',
        sessionPolicy: 'new',
        handoffWorkflow: { preset: 'team', phase: 'entry' },
      },
    });
  });

  it('disables both controls while the mutation is pending and ignores duplicate changes', async () => {
    let release!: () => void;
    mockUpdate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    renderControls(
      makeMessage({
        taskEnvelope: createTaskEnvelope({ conversationMode: 'code', sessionPolicy: 'continue' }),
      })
    );

    await selectModeOption('Chat');

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(modeCombobox()).toBeDisabled();
      expect(sessionCombobox()).toBeDisabled();
    });

    // A second change attempt while pending must not add another call.
    fireEvent.click(sessionCombobox());
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    release();
  });

  it('shows exactly "This task has already started." for a not-found mutation and reconciles to the prop', async () => {
    mockUpdate.mockRejectedValue(new Error('Queued message not found'));
    renderControls(
      makeMessage({
        taskEnvelope: createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'continue' }),
      })
    );

    await selectModeOption('Code');

    await waitFor(() => {
      expect(screen.getByTestId('queued-message-envelope-error')).toHaveTextContent(
        'This task has already started.'
      );
    });
    expect(screen.getByRole('alert')).toHaveTextContent('This task has already started.');
    // Controls remain reconciled to the reactive prop (no optimistic divergence).
    expect(modeCombobox()).toHaveTextContent('Chat');
    expect(sessionCombobox()).toHaveTextContent('Continue');
  });

  it('shows a concise generic error for other mutation failures', async () => {
    mockUpdate.mockRejectedValue(new Error('boom'));
    renderControls(
      makeMessage({
        taskEnvelope: createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'continue' }),
      })
    );

    await selectModeOption('Code');

    await waitFor(() => {
      expect(screen.getByTestId('queued-message-envelope-error')).toHaveTextContent(
        'Failed to update queued task settings.'
      );
    });
  });

  it('keyboard and click on a control do not activate an enclosing row; the row stays keyboard-accessible', async () => {
    const rowClick = vi.fn();
    const rowKeyDown = vi.fn((e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
    });
    render(
      <div role="button" tabIndex={0} onClick={rowClick} onKeyDown={rowKeyDown} data-testid="row">
        <QueuedMessageEnvelopeControls
          message={makeMessage({
            taskEnvelope: createTaskEnvelope({
              conversationMode: 'code',
              sessionPolicy: 'continue',
            }),
          })}
        />
      </div>
    );

    const mode = modeCombobox();
    // Controls are focusable (keyboard accessible).
    expect(mode).toHaveAttribute('tabindex', '0');

    fireEvent.click(mode);
    expect(rowClick).not.toHaveBeenCalled();

    fireEvent.keyDown(mode, { key: 'Enter' });
    fireEvent.keyDown(mode, { key: ' ' });
    expect(rowClick).not.toHaveBeenCalled();
    expect(rowKeyDown).not.toHaveBeenCalled();

    // Row-level Enter/Space still activates the row.
    fireEvent.keyDown(screen.getByTestId('row'), { key: 'Enter' });
    expect(rowKeyDown).toHaveBeenCalledTimes(1);
  });
});
