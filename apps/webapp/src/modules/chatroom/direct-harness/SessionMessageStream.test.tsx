import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll } from 'vitest';

import { SessionMessageStream } from './SessionMessageStream';

// Mock the data hooks directly.
const mockUseHarnessTurnStore = vi.fn();
const mockUseQueuedMessages = vi.fn().mockReturnValue([]);

vi.mock('./hooks/useHarnessTurnStore', () => ({
  useHarnessTurnStore: (...args: unknown[]) => mockUseHarnessTurnStore(...args),
}));

vi.mock('./hooks/useQueuedMessages', () => ({
  useQueuedMessages: (...args: unknown[]) => mockUseQueuedMessages(...args),
}));

window.HTMLElement.prototype.scrollIntoView = vi.fn();

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const SESSION_ROW_ID = 'sr1' as never;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function turn(
  id: string,
  role: 'user' | 'assistant',
  textContent: string,
  turnSeq: number,
  extras: {
    status?: 'pending' | 'streaming' | 'complete' | 'failed';
    reasoningContent?: string;
    messageId?: string;
  } = {}
) {
  return {
    _id: id as never,
    role,
    textContent,
    reasoningContent: extras.reasoningContent ?? '',
    turnSeq,
    status: extras.status ?? 'complete',
    startedAt: turnSeq * 1000,
    messageId: extras.messageId,
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
  turns: ReturnType<typeof turn>[];
  isLoading: boolean;
  hasMoreOlder: boolean;
  isLoadingOlder: boolean;
  loadOlderMessages: ReturnType<typeof vi.fn>;
  streamingOverlay: null | { turnId: unknown; textContent: string; reasoningContent: string };
};

function mockStore(turns: ReturnType<typeof turn>[], overrides: Partial<MockStoreShape> = {}) {
  mockUseHarnessTurnStore.mockReturnValue({
    turns,
    isLoading: false,
    hasMoreOlder: false,
    isLoadingOlder: false,
    loadOlderMessages: vi.fn(),
    streamingOverlay: null,
    ...overrides,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('SessionMessageStream', () => {
  // ── Loading / empty states ──────────────────────────────────────────────────

  it('renders loading state when isLoading=true', () => {
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

  it('renders user and assistant turns', () => {
    mockStore([turn('t1', 'user', 'Hello', 1), turn('t2', 'assistant', 'Hi there', 2)]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('renders turn.textContent for user turn', () => {
    mockStore([turn('t1', 'user', 'User message text', 1)]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('User message text')).toBeInTheDocument();
  });

  // ── Streaming overlay ───────────────────────────────────────────────────────

  it('uses streamingOverlay content for the matching assistant turn', () => {
    mockStore(
      [turn('t1', 'assistant', 'old content', 1, { status: 'streaming', messageId: 'msg-a' })],
      {
        streamingOverlay: {
          turnId: 't1' as never,
          textContent: 'live streamed text',
          reasoningContent: '',
        },
      }
    );
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('live streamed text')).toBeInTheDocument();
    expect(screen.queryByText('old content')).not.toBeInTheDocument();
  });

  it('renders ThinkingBlock when streamingOverlay has reasoningContent', () => {
    mockStore([turn('t1', 'assistant', '', 1, { status: 'streaming', messageId: 'msg-a' })], {
      streamingOverlay: {
        turnId: 't1' as never,
        textContent: 'answer',
        reasoningContent: 'reasoning thoughts',
      },
    });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByRole('button', { name: /thinking/i })).toBeInTheDocument();
  });

  it('uses turn.textContent and turn.reasoningContent for finalized assistant turns', () => {
    mockStore([
      turn('t1', 'assistant', 'finalized text', 1, { reasoningContent: 'finalized reasoning' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('finalized text')).toBeInTheDocument();
    // ThinkingBlock should be present (collapsed)
    expect(screen.getByRole('button', { name: /thinking/i })).toBeInTheDocument();
  });

  // ── Thinking blocks ─────────────────────────────────────────────────────────

  it('renders a collapsed ThinkingBlock when reasoningContent is present', () => {
    mockStore([
      turn('t1', 'assistant', 'The answer is 42', 1, { reasoningContent: 'Let me think...' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByRole('button', { name: /thinking/i })).toBeInTheDocument();
    expect(screen.queryByText('Let me think...')).not.toBeInTheDocument();
    expect(screen.getByText('The answer is 42')).toBeInTheDocument();
  });

  it('expands ThinkingBlock on click', async () => {
    const user = userEvent.setup();
    mockStore([turn('t1', 'assistant', 'response', 1, { reasoningContent: 'inner thoughts' })]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    await user.click(screen.getByRole('button', { name: /thinking/i }));
    expect(screen.getByText('inner thoughts')).toBeInTheDocument();
  });

  it('does not render ThinkingBlock when reasoningContent is empty', () => {
    mockStore([turn('t1', 'assistant', 'plain response', 1)]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByRole('button', { name: /thinking/i })).not.toBeInTheDocument();
  });

  // ── Pending turns ────────────────────────────────────────────────────────────

  it('renders nothing for a pending assistant turn with no messageId', () => {
    mockStore([turn('t1', 'assistant', '', 1, { status: 'pending' })]);
    const { container } = render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    // The scroll container is rendered but has no visible child content
    const scrollEl = container.firstChild as HTMLElement;
    expect(scrollEl.children).toHaveLength(0);
  });

  // ── Queued messages ─────────────────────────────────────────────────────────

  it('shows queued messages with a Queued badge below the main stream', () => {
    mockStore([turn('t1', 'user', 'First', 1)]);
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Queued follow-up')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Queued follow-up')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('does not show the queued zone when the queue is empty', () => {
    mockStore([turn('t1', 'user', 'Hello', 1)]);
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

  it('shows placeholder when only the queue is empty and turns are empty', () => {
    mockStore([]);
    mockUseQueuedMessages.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  it('does not show placeholder when turns are empty but queue has items', () => {
    mockStore([]);
    mockUseQueuedMessages.mockReturnValue([queuedMsg('q1', 'Waiting')]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByText(/waiting for response/i)).not.toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  // ── Load older turns (scroll-driven) ───────────────────────────────────────

  it('does not show a "load older messages" button (loading is scroll-driven)', () => {
    mockStore([turn('t1', 'user', 'Hello', 1)], { hasMoreOlder: true });
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByRole('button', { name: /load older messages/i })).not.toBeInTheDocument();
  });

  it('calls loadOlderMessages when scrolled near the top and hasMoreOlder is true', () => {
    const loadOlderMessages = vi.fn();
    mockStore([turn('t1', 'user', 'Hello', 1)], { hasMoreOlder: true, loadOlderMessages });
    const { container } = render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    const scrollEl = container.firstChild as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollTop', { value: 50, configurable: true });
    fireEvent.scroll(scrollEl);
    expect(loadOlderMessages).toHaveBeenCalled();
  });

  it('does not call loadOlderMessages on scroll when hasMoreOlder is false', () => {
    const loadOlderMessages = vi.fn();
    mockStore([turn('t1', 'user', 'Hello', 1)], { hasMoreOlder: false, loadOlderMessages });
    const { container } = render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    const scrollEl = container.firstChild as HTMLElement;
    Object.defineProperty(scrollEl, 'scrollTop', { value: 500, configurable: true });
    fireEvent.scroll(scrollEl);
    expect(loadOlderMessages).not.toHaveBeenCalled();
  });
});
