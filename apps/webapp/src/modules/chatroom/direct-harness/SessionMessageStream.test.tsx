import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { SessionMessageStream } from './SessionMessageStream';

const mockUseSessionQuery = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (...args: unknown[]) => mockUseSessionQuery(...args),
}));

// scrollIntoView is not implemented in jsdom
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

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('SessionMessageStream', () => {
  // ── Loading / empty states ──────────────────────────────────────────────────

  it('renders loading state when query returns undefined', () => {
    mockUseSessionQuery.mockReturnValue(undefined);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders empty placeholder when there are no messages', () => {
    mockUseSessionQuery.mockReturnValue([]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText(/waiting for response/i)).toBeInTheDocument();
  });

  // ── Basic rendering ─────────────────────────────────────────────────────────

  it('renders user and assistant messages', () => {
    mockUseSessionQuery.mockReturnValue([
      msg('m1', 'user',      'Hello',    1),
      msg('m2', 'assistant', 'Hi there', 2),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  // ── Token merging ───────────────────────────────────────────────────────────

  it('merges assistant tokens with the same messageId into one bubble', () => {
    mockUseSessionQuery.mockReturnValue([
      msg('m1', 'user',      'Hi',   1),
      msg('m2', 'assistant', 'Hel',  2, { messageId: 'msg-a', partType: 'text' }),
      msg('m3', 'assistant', 'lo!',  3, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('Hello!')).toBeInTheDocument();
    // Should be exactly one assistant bubble (not two separate ones)
    expect(screen.queryByText('Hel')).not.toBeInTheDocument();
    expect(screen.queryByText('lo!')).not.toBeInTheDocument();
  });

  it('merges legacy assistant tokens (no messageId) consecutively', () => {
    mockUseSessionQuery.mockReturnValue([
      msg('m1', 'assistant', 'foo', 1),
      msg('m2', 'assistant', 'bar', 2),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('foobar')).toBeInTheDocument();
  });

  // ── Turn isolation ──────────────────────────────────────────────────────────

  it('does not split an agent turn when a user message arrives mid-stream', () => {
    // Simulates: agent streams tokens 2-4, user sends msg at seq 3,
    // agent streams more tokens 5-6 — all with the same messageId.
    mockUseSessionQuery.mockReturnValue([
      msg('m1', 'user',      'First',  1),
      msg('m2', 'assistant', 'A',      2, { messageId: 'msg-a', partType: 'text' }),
      msg('m3', 'user',      'Second', 3),    // arrives mid-stream
      msg('m4', 'assistant', 'B',      4, { messageId: 'msg-a', partType: 'text' }),
      msg('m5', 'assistant', 'C',      5, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);

    // The agent turn should appear as a single merged bubble "ABC"
    expect(screen.getByText('ABC')).toBeInTheDocument();
    // "Second" should still be visible as its own user bubble
    expect(screen.getByText('Second')).toBeInTheDocument();
    // The raw partial tokens must not appear as separate elements
    expect(screen.queryByText('A')).not.toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
    expect(screen.queryByText('C')).not.toBeInTheDocument();
  });

  it('renders two distinct agent turns when they have different messageIds', () => {
    mockUseSessionQuery.mockReturnValue([
      msg('m1', 'user',      'Q1',  1),
      msg('m2', 'assistant', 'R1',  2, { messageId: 'msg-a', partType: 'text' }),
      msg('m3', 'user',      'Q2',  3),
      msg('m4', 'assistant', 'R2',  4, { messageId: 'msg-b', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
  });

  // ── Thinking blocks ─────────────────────────────────────────────────────────

  it('renders a ThinkingBlock toggle when reasoning tokens are present', () => {
    mockUseSessionQuery.mockReturnValue([
      msg('m1', 'assistant', 'Let me think...', 1, { messageId: 'msg-a', partType: 'reasoning' }),
      msg('m2', 'assistant', 'The answer is 42', 2, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);

    // Thinking toggle header is visible
    expect(screen.getByRole('button', { name: /thinking/i })).toBeInTheDocument();
    // Thinking content is collapsed by default
    expect(screen.queryByText('Let me think...')).not.toBeInTheDocument();
    // Text response is always visible
    expect(screen.getByText('The answer is 42')).toBeInTheDocument();
  });

  it('expands ThinkingBlock when toggled', async () => {
    const user = userEvent.setup();
    mockUseSessionQuery.mockReturnValue([
      msg('m1', 'assistant', 'inner thoughts', 1, { messageId: 'msg-a', partType: 'reasoning' }),
      msg('m2', 'assistant', 'response',       2, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);

    const toggle = screen.getByRole('button', { name: /thinking/i });
    await user.click(toggle);

    expect(screen.getByText('inner thoughts')).toBeInTheDocument();
  });

  it('does not render a ThinkingBlock when there are no reasoning tokens', () => {
    mockUseSessionQuery.mockReturnValue([
      msg('m1', 'assistant', 'plain response', 1, { messageId: 'msg-a', partType: 'text' }),
    ]);
    render(<SessionMessageStream sessionRowId={SESSION_ROW_ID} />);
    expect(screen.queryByRole('button', { name: /thinking/i })).not.toBeInTheDocument();
    expect(screen.getByText('plain response')).toBeInTheDocument();
  });
});
