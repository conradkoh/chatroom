import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll } from 'vitest';

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

// ResizeObserver is not available in jsdom — provide a no-op stub
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const SESSION_ROW_ID = 'sr1' as never;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function msg(
  id: string,
  role: 'user' | 'assistant',
  content: string,
  seq: number,
  extras: { messageId?: string; partType?: 'text' | 'reasoning' } = {}
) {
  return {
    _id: id as never,
    role,
    content,
    seq,
    timestamp: seq * 1000,
    harnessSessionId: SESSION_ROW_ID,
    ...extras,
  };
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

type MockStoreShape = {
  messages: ReturnType<typeof msg>[];
  isLoading: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  loadOlderMessages: ReturnType<typeof vi.fn>;
};

type StoreOverrides = Partial<MockStoreShape>;

function mockStore(messages: ReturnType<typeof msg>[], overrides: StoreOverrides = {}) {
  mockUseHarnessMessageStore.mockReturnValue({
    messages,
    isLoading: false,
    hasMoreOlder: false,
    isLoadingOlder: false,
    loadOlderMessages: vi.fn(),
    ...overrides,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('SessionMessageStream', () => {
  // ── Loading / empty states ──────────────────────────────────────────────────

  it('renders loading state when query returns undefined', () => {
    mockStore([], { isLoading: true });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders empty placeholder when both streams are empty', () => {
    mockStore([]);
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  // ── Basic rendering ─────────────────────────────────────────────────────────

  it('renders user and assistant messages', () => {
    mockStore([msg('m1', 'user', 'Hello', 1), msg('m2', 'assistant', 'Hi there', 2)]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  // ── Token merging ───────────────────────────────────────────────────────────

  it('merges assistant tokens with the same messageId into one bubble', () => {
    mockStore([
      msg('m1', 'user', 'Hi', 1),
      msg('m2', 'assistant', 'Hel', 2, { messageId: 'msg-a', partType: 'text' }),
      msg('m3', 'assistant', 'lo!', 3, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello!')).toBeInTheDocument();
    expect(screen.queryByText('Hel')).not.toBeInTheDocument();
  });

  it('merges legacy assistant tokens (no messageId) consecutively', () => {
    mockStore([msg('m1', 'assistant', 'foo', 1), msg('m2', 'assistant', 'bar', 2)]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('foobar')).toBeInTheDocument();
  });

  // ── Turn isolation ──────────────────────────────────────────────────────────

  it('does not split an agent turn when a user message arrives mid-stream', () => {
    mockStore([
      msg('m1', 'user', 'First', 1),
      msg('m2', 'assistant', 'A', 2, { messageId: 'msg-a', partType: 'text' }),
      msg('m3', 'user', 'Second', 3),
      msg('m4', 'assistant', 'B', 4, { messageId: 'msg-a', partType: 'text' }),
      msg('m5', 'assistant', 'C', 5, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('ABC')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('renders two distinct agent turns for different messageIds', () => {
    mockStore([
      msg('m1', 'user', 'Q1', 1),
      msg('m2', 'assistant', 'R1', 2, { messageId: 'msg-a', partType: 'text' }),
      msg('m3', 'user', 'Q2', 3),
      msg('m4', 'assistant', 'R2', 4, { messageId: 'msg-b', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
  });

  // ── Thinking blocks ─────────────────────────────────────────────────────────

  it('renders a collapsed ThinkingBlock when reasoning tokens are present', () => {
    mockStore([
      msg('m1', 'assistant', 'Let me think...', 1, { messageId: 'msg-a', partType: 'reasoning' }),
      msg('m2', 'assistant', 'The answer is 42', 2, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByRole('button', { name: /thinking/i })).toBeInTheDocument();
    expect(screen.queryByText('Let me think...')).not.toBeInTheDocument();
    expect(screen.getByText('The answer is 42')).toBeInTheDocument();
  });

  it('expands ThinkingBlock on click', async () => {
    const user = userEvent.setup();
    mockStore([
      msg('m1', 'assistant', 'inner thoughts', 1, { messageId: 'msg-a', partType: 'reasoning' }),
      msg('m2', 'assistant', 'response', 2, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    await user.click(screen.getByRole('button', { name: /thinking/i }));
    expect(screen.getByText('inner thoughts')).toBeInTheDocument();
  });

  it('does not render ThinkingBlock when there are no reasoning tokens', () => {
    mockStore([
      msg('m1', 'assistant', 'plain response', 1, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByRole('button', { name: /thinking/i })).not.toBeInTheDocument();
  });

  // ── Queued messages ─────────────────────────────────────────────────────────

  it('shows queued messages with a Queued badge below the main stream', () => {
    mockStore([msg('m1', 'user', 'First', 1)]);
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Queued follow-up')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Queued follow-up')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('does not show the queued zone when the queue is empty', () => {
    mockStore([msg('m1', 'user', 'Hello', 1)]);
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
  });

  it('renders multiple queued messages in FIFO order', () => {
    mockStore([]);
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Alpha'), queuedMsg('q2', 'Beta')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    const items = screen.getAllByText(/^(Alpha|Beta)$/);
    expect(items[0]?.textContent).toBe('Alpha');
    expect(items[1]?.textContent).toBe('Beta');
  });

  it('shows placeholder when only the queue is empty and messages are empty', () => {
    mockStore([]);
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  it('does not show placeholder when messages are empty but queue has items', () => {
    mockStore([]);
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Waiting')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByText(/waiting for response/i)).not.toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  // ── Load older messages (scroll-driven) ────────────────────────────────────

  it('does not show a "load older messages" button (loading is scroll-driven)', () => {
    mockStore([msg('m1', 'user', 'Hello', 1)], { hasMoreOlder: true });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByRole('button', { name: /load older messages/i })).not.toBeInTheDocument();
  });

  it('calls loadOlderMessages when scrolled near the top and hasMoreOlder is true', () => {
    const loadOlderMessages = vi.fn();
    mockStore([msg('m1', 'user', 'Hello', 1)], { hasMoreOlder: true, loadOlderMessages });
    const { container } = render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    const scrollEl = container.firstChild as HTMLElement;
    // Simulate scroll near top (scrollTop < 100)
    Object.defineProperty(scrollEl, 'scrollTop', { value: 50, configurable: true });
    fireEvent.scroll(scrollEl);
    expect(loadOlderMessages).toHaveBeenCalled();
  });

  it('does not call loadOlderMessages on scroll when hasMoreOlder is false', () => {
    const loadOlderMessages = vi.fn();
    mockStore([msg('m1', 'user', 'Hello', 1)], { hasMoreOlder: false, loadOlderMessages });
    const { container } = render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    const scrollEl = container.firstChild as HTMLElement;
    // scrollTop > threshold, far from top
    Object.defineProperty(scrollEl, 'scrollTop', { value: 500, configurable: true });
    fireEvent.scroll(scrollEl);
    expect(loadOlderMessages).not.toHaveBeenCalled();
  });
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('SessionMessageStream', () => {
  // ── Loading / empty states ──────────────────────────────────────────────────

  it('renders loading state when query returns undefined', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [],
      isLoading: true,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders empty placeholder when both streams are empty', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  // ── Basic rendering ─────────────────────────────────────────────────────────

  it('renders user and assistant messages', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'Hello', 1), msg('m2', 'assistant', 'Hi there', 2)],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  // ── Token merging ───────────────────────────────────────────────────────────

  it('merges assistant tokens with the same messageId into one bubble', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [
        msg('m1', 'user', 'Hi', 1),
        msg('m2', 'assistant', 'Hel', 2, { messageId: 'msg-a', partType: 'text' }),
        msg('m3', 'assistant', 'lo!', 3, { messageId: 'msg-a', partType: 'text' }),
      ],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello!')).toBeInTheDocument();
    expect(screen.queryByText('Hel')).not.toBeInTheDocument();
  });

  it('merges legacy assistant tokens (no messageId) consecutively', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'assistant', 'foo', 1), msg('m2', 'assistant', 'bar', 2)],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('foobar')).toBeInTheDocument();
  });

  // ── Turn isolation ──────────────────────────────────────────────────────────

  it('does not split an agent turn when a user message arrives mid-stream', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [
        msg('m1', 'user', 'First', 1),
        msg('m2', 'assistant', 'A', 2, { messageId: 'msg-a', partType: 'text' }),
        msg('m3', 'user', 'Second', 3),
        msg('m4', 'assistant', 'B', 4, { messageId: 'msg-a', partType: 'text' }),
        msg('m5', 'assistant', 'C', 5, { messageId: 'msg-a', partType: 'text' }),
      ],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('ABC')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.queryByText('A')).not.toBeInTheDocument();
  });

  it('renders two distinct agent turns for different messageIds', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [
        msg('m1', 'user', 'Q1', 1),
        msg('m2', 'assistant', 'R1', 2, { messageId: 'msg-a', partType: 'text' }),
        msg('m3', 'user', 'Q2', 3),
        msg('m4', 'assistant', 'R2', 4, { messageId: 'msg-b', partType: 'text' }),
      ],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
  });

  // ── Thinking blocks ─────────────────────────────────────────────────────────

  it('renders a collapsed ThinkingBlock when reasoning tokens are present', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [
        msg('m1', 'assistant', 'Let me think...', 1, { messageId: 'msg-a', partType: 'reasoning' }),
        msg('m2', 'assistant', 'The answer is 42', 2, { messageId: 'msg-a', partType: 'text' }),
      ],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByRole('button', { name: /thinking/i })).toBeInTheDocument();
    expect(screen.queryByText('Let me think...')).not.toBeInTheDocument();
    expect(screen.getByText('The answer is 42')).toBeInTheDocument();
  });

  it('expands ThinkingBlock on click', async () => {
    const user = userEvent.setup();
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [
        msg('m1', 'assistant', 'inner thoughts', 1, { messageId: 'msg-a', partType: 'reasoning' }),
        msg('m2', 'assistant', 'response', 2, { messageId: 'msg-a', partType: 'text' }),
      ],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    await user.click(screen.getByRole('button', { name: /thinking/i }));
    expect(screen.getByText('inner thoughts')).toBeInTheDocument();
  });

  it('does not render ThinkingBlock when there are no reasoning tokens', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [
        msg('m1', 'assistant', 'plain response', 1, { messageId: 'msg-a', partType: 'text' }),
      ],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByRole('button', { name: /thinking/i })).not.toBeInTheDocument();
  });

  // ── Queued messages ─────────────────────────────────────────────────────────

  it('shows queued messages with a Queued badge below the main stream', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'First', 1)],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Queued follow-up')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Queued follow-up')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('does not show the queued zone when the queue is empty', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'Hello', 1)],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
  });

  it('renders multiple queued messages in FIFO order', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Alpha'), queuedMsg('q2', 'Beta')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    const items = screen.getAllByText(/^(Alpha|Beta)$/);
    expect(items[0]?.textContent).toBe('Alpha');
    expect(items[1]?.textContent).toBe('Beta');
  });

  it('shows placeholder when only the queue is empty and messages are empty', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  it('does not show placeholder when messages are empty but queue has items', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Waiting')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByText(/waiting for response/i)).not.toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  // ── Load older messages (scroll-driven) ────────────────────────────────────

  it('does not show a "load older messages" button (loading is scroll-driven)', () => {
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'Hello', 1)],
      isLoading: false,
      hasMoreOlder: true,
      isLoadingOlder: false,
      loadOlderMessages: vi.fn(),
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByRole('button', { name: /load older messages/i })).not.toBeInTheDocument();
  });

  it('calls loadOlderMessages when scrolled near the top and hasMoreOlder is true', () => {
    const loadOlderMessages = vi.fn();
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'Hello', 1)],
      isLoading: false,
      hasMoreOlder: true,
      isLoadingOlder: false,
      loadOlderMessages,
    });
    const { container } = render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    const scrollEl = container.firstChild as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollTop', { value: 50, configurable: true });
    fireEvent.scroll(scrollEl);
    expect(loadOlderMessages).toHaveBeenCalled();
  });

  it('does not call loadOlderMessages on scroll when hasMoreOlder is false', () => {
    const loadOlderMessages = vi.fn();
    mockUseHarnessMessageStore.mockReturnValue({
      messages: [msg('m1', 'user', 'Hello', 1)],
      isLoading: false,
      hasMoreOlder: false,
      isLoadingOlder: false,
      loadOlderMessages,
    });
    const { container } = render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    const scrollEl = container.firstChild as HTMLElement;
    // scrollTop > threshold, far from top
    Object.defineProperty(scrollEl, 'scrollTop', { value: 500, configurable: true });
    fireEvent.scroll(scrollEl);
    expect(loadOlderMessages).not.toHaveBeenCalled();
  });
});
