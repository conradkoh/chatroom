/**
 * TimelineMessageFooter — copy, download, attach-as-context, and timestamp.
 */

// matchMedia polyfill needed by useIsDesktop (used by MessageDownloadMenu)
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TimelineMessageFooter, TimelineMessageTimestamp } from './TimelineMessageFooter';
import { AttachmentsProvider } from '../../attachments';
import type { Message } from '../../types/message';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

vi.mock('../../utils/chatroomTimestamp', () => ({
  formatTimestamp: (time: number) => `TS:${time}`,
  formatTimestampFull: (time: number) => `TS_FULL:${time}`,
  formatTimeOfDay: (time: number) => `TOD:${time}`,
}));

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'Hello footer',
    _creationTime: 1_700_000_000_000,
    ...overrides,
  };
}

function renderFooter(
  message: Message,
  props: {
    handoffDurationMs?: number;
  } = {}
) {
  return render(
    <AttachmentsProvider>
      <TimelineMessageFooter message={message} {...props} />
    </AttachmentsProvider>
  );
}

describe('TimelineMessageFooter', () => {
  it('renders copy, download, attach, and timestamp', () => {
    renderFooter(makeMessage());
    expect(screen.getByTestId('timeline-message-footer')).toBeInTheDocument();
    expect(screen.getByTitle('Copy as markdown')).toBeInTheDocument();
    expect(screen.getByTitle('Download message')).toBeInTheDocument();
    expect(screen.getByTitle('Add to context')).toBeInTheDocument();
    expect(screen.getByText('TS:1700000000000')).toBeInTheDocument();
  });

  it('shows handoff duration before the existing timestamp', () => {
    renderFooter(makeMessage(), { handoffDurationMs: 62_000 });

    const duration = screen.getByTestId('timeline-handoff-duration');
    expect(duration).toHaveTextContent('1m 2s');
    expect(duration).toHaveAttribute('title', 'Time since task started: 1m 2s');
    expect(duration.compareDocumentPosition(screen.getByText('TS:1700000000000'))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('hides handoff duration when no timing is supplied', () => {
    renderFooter(makeMessage());
    expect(screen.queryByTestId('timeline-handoff-duration')).not.toBeInTheDocument();
  });
});

describe('TimelineMessageTimestamp', () => {
  const CREATION_TIME = 1_700_000_000_000;

  it('renders the footer timestamp markup in non-compact mode', () => {
    render(<TimelineMessageTimestamp creationTime={CREATION_TIME} handoffDurationMs={62_000} />);

    const duration = screen.getByTestId('timeline-handoff-duration');
    expect(duration).toHaveTextContent('1m 2s');
    expect(duration).toHaveAttribute('title', 'Time since task started: 1m 2s');
    expect(duration).not.toHaveClass('hidden');
    expect(duration).not.toHaveClass('sm:inline');

    const fullDate = screen.getByText(`TS:${CREATION_TIME}`);
    expect(fullDate).toHaveAttribute('title', `TS_FULL:${CREATION_TIME}`);
    expect(screen.queryByText(`TOD:${CREATION_TIME}`)).not.toBeInTheDocument();
  });

  it('renders the compact variant with responsive duration and time-of-day spans', () => {
    render(
      <TimelineMessageTimestamp creationTime={CREATION_TIME} handoffDurationMs={62_000} compact />
    );

    const duration = screen.getByTestId('timeline-handoff-duration');
    expect(duration).toHaveTextContent('1m 2s');
    expect(duration).toHaveClass('hidden', 'sm:inline');

    const fullDate = screen.getByText(`TS:${CREATION_TIME}`);
    expect(fullDate).toHaveClass('hidden', 'sm:inline');
    expect(fullDate.parentElement).toHaveAttribute('title', `TS_FULL:${CREATION_TIME}`);

    const timeOfDay = screen.getByText(`TOD:${CREATION_TIME}`);
    expect(timeOfDay).toHaveClass('sm:hidden');
  });
});
