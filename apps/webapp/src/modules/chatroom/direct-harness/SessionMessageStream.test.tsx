import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { SessionMessageStream } from './SessionMessageStream';

// Mock the data hooks directly so each can return independent values.
const mockUseHarnessMessageStore = vi.fn();
const mockUseQueuedMessages = vi.fn().mockReturnValue([]);

vi.mock('./hooks/useHarnessMessageStore', () => ({
  useHarnessMessageStore: (...args: unknown[]) => mockUseHarnessMessageStore(...args),
}));

vi.mock('./hooks/useQueuedMessages', () => ({
  useQueuedMessages: (...args: unknown[]) => mockUseQueuedMessages(...args),
}));

window.HTMLElement.prototype.scrollIntoView = vi.fn();

const SESSION_ROW_ID = 'sr1' as never;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function msg(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  seq: number,
  extras: { messageId?: string; partType?: 'text' | 'reasoning' } = {}
) {
  return { _id: id as never, role, content, seq, timestamp: seq * 1000, harnessSessionId: SESSION_ROW_ID, ...extras };
}

function queuedMsg(id: string, content: string) {
  return {
    _id: id as never,
    _creationTime: Date.now(),
    harnessSessionId: SESSION_ROW_ID,
    content,
    timestamp: Date.now(),
    status: 'queued' as const,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('SessionMessageStream', () => {
  // ── Loading / empty states ──────────────────────────────────────────────────

  it('renders loading state when query returns undefined', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [], isLoading: true, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders empty placeholder when both streams are empty', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  // ── Basic rendering ─────────────────────────────────────────────────────────

  it('renders user and assistant messages', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [
      msg('m1', 'user',      'Hello',    1),
      msg('m2', 'assistant', 'Hi there', 2),
    ], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  // ── Token merging ───────────────────────────────────────────────────────────

  it('merges assistant tokens with the same messageId into one bubble', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [
      msg('m1', 'user',      'Hi',  1),
      msg('m2', 'assistant', 'Hel', 2, { messageId: 'msg-a', partType: 'text' }),
      msg('m3', 'assistant', 'lo!', 3, { messageId: 'msg-a', partType: 'text' }),
    ], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello!')).toBeInTheDocument();
    expect(screen.queryByText('Hel')).not.toBeInTheDocument();
  });

  it('merges legacy assistant tokens (no messageId) consecutively', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [
      msg('m1', 'assistant', 'foo', 1),
      msg('m2', 'assistant', 'bar', 2),
    ], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('foobar')).toBeInTheDocument();
  });

  // ── Turn isolation ──────────────────────────────────────────────────────────

  it('does not split an agent turn when a user message arrives mid-stream', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [
      msg('m1', 'user',      'First',  1),
      msg('m2', 'assistant', 'A',      2, { messageId: 'msg-a', partType: 'text' }),
      msg('m3', 'user',      'Second', 3),
      msg('m4', 'assistant', 'B',      4, { messageId: 'msg-a', partType: 'text' }),
      msg('m5', 'assistant', 'C',      5, { messageId: 'msg-a', partType: 'text' }),
    ], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('ABC')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('renders two distinct agent turns for different messageIds', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [
      msg('m1', 'user',      'Q1', 1),
      msg('m2', 'assistant', 'R1', 2, { messageId: 'msg-a', partType: 'text' }),
      msg('m3', 'user',      'Q2', 3),
      msg('m4', 'assistant', 'R2', 4, { messageId: 'msg-b', partType: 'text' }),
    ], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
  });

  // ── Thinking blocks ─────────────────────────────────────────────────────────

  it('renders a collapsed ThinkingBlock when reasoning tokens are present', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [
      msg('m1', 'assistant', 'Let me think...', 1, { messageId: 'msg-a', partType: 'reasoning' }),
      msg('m2', 'assistant', 'The answer is 42', 2, { messageId: 'msg-a', partType: 'text' }),
    ], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByRole('button', { name: /thinking/i })).toBeInTheDocument();
    expect(screen.queryByText('Let me think...')).not.toBeInTheDocument();
    expect(screen.getByText('The answer is 42')).toBeInTheDocument();
  });

  it('expands ThinkingBlock on click', async () => {
    const user = userEvent.setup();
    mockUseHarnessMessageStore.mockReturnValue({ messages: [
      msg('m1', 'assistant', 'inner thoughts', 1, { messageId: 'msg-a', partType: 'reasoning' }),
      msg('m2', 'assistant', 'response',       2, { messageId: 'msg-a', partType: 'text' }),
    ], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    await user.click(screen.getByRole('button', { name: /thinking/i }));
    expect(screen.getByText('inner thoughts')).toBeInTheDocument();
  });

  it('does not render ThinkingBlock when there are no reasoning tokens', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [
      msg('m1', 'assistant', 'plain response', 1, { messageId: 'msg-a', partType: 'text' }),
    ], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByRole('button', { name: /thinking/i })).not.toBeInTheDocument();
  });

  // ── Queued messages ─────────────────────────────────────────────────────────

  it('shows queued messages with a Queued badge below the main stream', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [msg('m1', 'user', 'First', 1)], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Queued follow-up')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Queued follow-up')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('does not show the queued zone when the queue is empty', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [msg('m1', 'user', 'Hello', 1)], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
  });

  it('renders multiple queued messages in FIFO order', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Alpha'), queuedMsg('q2', 'Beta')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    const items = screen.getAllByText(/^(Alpha|Beta)$/);
    expect(items[0]?.textContent).toBe('Alpha');
    expect(items[1]?.textContent).toBe('Beta');
  });

  it('shows placeholder when only the queue is empty and messages are empty', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  it('does not show placeholder when messages are empty but queue has items', () => {
    mockUseHarnessMessageStore.mockReturnValue({ messages: [], isLoading: false, hasMoreOlder: false, isLoadingOlder: false, loadOlderMessages: vi.fn() });
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Waiting')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByText(/waiting for response/i)).not.toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  // ── Load older messages ─────────────────────────────────────────────────────

  it('shows load older button when hasMoreOlder is true', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'Hello', 1)],
      isLoading: false,
      hasMoreOlder: true,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByRole('button', { name: /load older messages/i })).toBeInTheDocument();
  });

  it('hides load older button when hasMoreOlder is false', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'Hello', 1)],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByRole('button', { name: /load older messages/i })).not.toBeInTheDocument();
  });

  it('calls loadOlderMessages when the button is clicked', async () => {
    const loadOlderMessages = vi.fn();
    const user = userEvent.setup();
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'Hello', 1)],
      isLoading: false,
      hasMoreOlder: true,
      isLoadingOlder: false,
      loadOlderMessages,
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    await user.click(screen.getByRole('button', { name: /load older messages/i }));
    expect(loadOlderMessages).toHaveBeenCalledOnce();
  });

  it('shows loading state on the button while isLoadingOlder is true', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'Hello', 1)],
      isLoading: false,
      hasMoreOlder: true,
      isLoadingOlder: true,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
  });
});
