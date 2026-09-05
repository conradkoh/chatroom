/**
 * QueuedMessageEnvelopeControls — Unit Tests
 *
 * Verifies the shared stateless envelope editor: tap-to-cycle mode toggle,
 * binary session toggle, legacy-scalar fallback, pending guards,
 * error mapping, and event isolation from an enclosing row.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function modeToggle() {
  return screen.getByTestId('queued-message-mode-toggle');
}

function sessionToggle() {
  return screen.getByTestId('queued-message-session-toggle');
}

beforeEach(() => {
  mockUpdate.mockReset();
  mockUpdate.mockResolvedValue(undefined);
});

describe('QueuedMessageEnvelopeControls', () => {
  it('renders mode and session toggles with correct initial state', async () => {
    const envelope: TaskEnvelopeV1 = {
      version: 1,
      conversationMode: 'chat',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'direct', phase: 'entry' },
    };
    renderControls(makeMessage({ taskEnvelope: envelope }));

    expect(modeToggle()).toBeInTheDocument();
    expect(sessionToggle()).toBeInTheDocument();
    expect(modeToggle()).toHaveAttribute('aria-label', expect.stringContaining('Chat'));
    expect(sessionToggle()).toHaveAttribute('aria-pressed', 'false');

    // No dropdowns remain.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('mode toggle cycles chat → code and sends one complete envelope with preserved session policy', async () => {
    const envelope: TaskEnvelopeV1 = createTaskEnvelope({
      conversationMode: 'chat',
      sessionPolicy: 'new',
    });
    renderControls(makeMessage({ taskEnvelope: envelope }));

    fireEvent.click(modeToggle());

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

  it('session toggle flips continue → new preserving mode and current non-entry workflow', async () => {
    const envelope: TaskEnvelopeV1 = {
      version: 1,
      conversationMode: 'code',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'team', phase: 'implementation' },
    };
    renderControls(makeMessage({ taskEnvelope: envelope }));

    fireEvent.click(sessionToggle());

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

    expect(modeToggle()).toHaveAttribute('aria-label', expect.stringContaining('Chat'));
    expect(sessionToggle()).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(modeToggle());

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

  it('disables both toggles while the mutation is pending and ignores duplicate taps', async () => {
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

    fireEvent.click(modeToggle());

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledTimes(1);
      expect(modeToggle()).toBeDisabled();
      expect(sessionToggle()).toBeDisabled();
    });

    // A second tap attempt while pending must not add another call.
    fireEvent.click(sessionToggle());
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

    fireEvent.click(modeToggle());

    await waitFor(() => {
      expect(screen.getByTestId('queued-message-envelope-error')).toHaveTextContent(
        'This task has already started.'
      );
    });
    expect(screen.getByRole('alert')).toHaveTextContent('This task has already started.');
    // Controls remain reconciled to the reactive prop (no optimistic divergence).
    expect(modeToggle()).toHaveAttribute('aria-label', expect.stringContaining('Chat'));
    expect(sessionToggle()).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows a concise generic error for other mutation failures', async () => {
    mockUpdate.mockRejectedValue(new Error('boom'));
    renderControls(
      makeMessage({
        taskEnvelope: createTaskEnvelope({ conversationMode: 'chat', sessionPolicy: 'continue' }),
      })
    );

    fireEvent.click(modeToggle());

    await waitFor(() => {
      expect(screen.getByTestId('queued-message-envelope-error')).toHaveTextContent(
        'Failed to update queued task settings.'
      );
    });
  });

  it('keyboard and click on a toggle do not activate an enclosing row; the row stays keyboard-accessible', async () => {
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

    const mode = modeToggle();
    // Native buttons are keyboard accessible without extra tabindex wiring.
    expect(mode.tagName).toBe('BUTTON');

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
