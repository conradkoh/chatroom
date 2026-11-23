/**
 * TimelineMessageFooter — copy, download, attach-as-context, and timestamp.
 */

// matchMedia polyfill needed by useIsDesktop (used by MessageDownloadMenu)
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TimelineMessageFooter, TimelineMessageTimestamp } from './TimelineMessageFooter';
import { TIMELINE_FOOTER_TIMESTAMP } from './timelineRowStyles';
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
    handoffDurationSlow?: boolean;
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

  it('shows the handoff duration after the timestamp', () => {
    renderFooter(makeMessage(), { handoffDurationMs: 62_000 });

    const duration = screen.getByTestId('timeline-handoff-duration');
    expect(duration).toHaveTextContent('1m 2s');
    expect(duration).toHaveAttribute('title', 'Time since previous message: 1m 2s');
    expect(screen.getByText('TS:1700000000000').compareDocumentPosition(duration)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('hides handoff duration when no timing is supplied', () => {
    renderFooter(makeMessage());
    expect(screen.queryByTestId('timeline-handoff-duration')).not.toBeInTheDocument();
  });

  it('forwards the slow tone from the footer to the timestamp', () => {
    renderFooter(makeMessage(), { handoffDurationMs: 420_000, handoffDurationSlow: true });

    const duration = screen.getByTestId('timeline-handoff-duration');
    expect(duration).toHaveAttribute('data-duration-tone', 'slow');
    expect(duration).toHaveClass('text-chatroom-status-slow');
  });

  it('merges className onto the footer root and keeps the wrap-friendly base classes', () => {
    render(
      <AttachmentsProvider>
        <TimelineMessageFooter message={makeMessage()} className="custom-footer-class" />
      </AttachmentsProvider>
    );
    const footer = screen.getByTestId('timeline-message-footer');
    expect(footer).toHaveClass('custom-footer-class', 'flex-wrap', 'mt-2');
  });

  describe('handoff layout', () => {
    const HANDOFF: Message = {
      _id: 'msg-handoff',
      type: 'handoff',
      senderRole: 'builder',
      targetRole: 'planner',
      content: 'Handoff content',
      _creationTime: 1_700_000_000_000,
      senderAgent: { harness: 'opencode', model: 'gpt-5.1-codex' },
    };

    it('is a two-column grid: controls | time row, then the agent row across both columns', () => {
      renderFooter(HANDOFF, { handoffDurationMs: 62_000 });

      const footer = screen.getByTestId('timeline-message-footer');
      expect(footer).toHaveAttribute('data-footer-layout', 'handoff');
      expect(footer).toHaveClass('grid', 'grid-cols-[auto_minmax(0,1fr)]');

      const [controls, timeRow, agentRow] = Array.from(footer.children) as HTMLElement[];
      expect(controls).toContainElement(screen.getByTitle('Copy as markdown'));
      expect(controls).toContainElement(screen.getByTitle('Download message'));
      expect(controls).toContainElement(screen.getByTitle('Add to context'));

      expect(timeRow).toBe(screen.getByTestId('timeline-footer-time-row'));
      expect(timeRow).toHaveClass('justify-end');
      expect(timeRow.children).toHaveLength(2);
      const [timestamp, slot] = Array.from(timeRow.children) as HTMLElement[];
      expect(timestamp).toHaveTextContent('TS:1700000000000');
      expect(slot).toBe(screen.getByTestId('timeline-handoff-duration-slot'));
      expect(slot).toHaveClass('w-[7ch]', 'shrink-0', 'font-mono', 'text-[10px]');
      expect(slot).toContainElement(screen.getByTestId('timeline-handoff-duration'));

      expect(agentRow).toBe(screen.getByTestId('timeline-footer-agent-row'));
      expect(agentRow).toHaveClass('col-span-2', 'justify-end');
      expect(screen.getByTestId('timeline-sender-agent')).toHaveAttribute(
        'data-placement',
        'footer'
      );
    });

    it('renders the empty duration slot and keeps the timestamp when there is no timing', () => {
      renderFooter(HANDOFF);

      const slot = screen.getByTestId('timeline-handoff-duration-slot');
      expect(slot).toBeEmptyDOMElement();
      expect(screen.queryByTestId('timeline-handoff-duration')).not.toBeInTheDocument();

      const timeRow = screen.getByTestId('timeline-footer-time-row');
      expect(timeRow).toContainElement(screen.getByText('TS:1700000000000'));
    });

    it('leaves the agent row empty for a legacy handoff without a snapshot', () => {
      renderFooter({ ...HANDOFF, senderAgent: undefined });

      const agentRow = screen.getByTestId('timeline-footer-agent-row');
      expect(agentRow).toBeEmptyDOMElement();
      expect(screen.queryByTestId('timeline-sender-agent')).not.toBeInTheDocument();
    });

    it('renders only the harness in the agent row when the snapshot has no model', () => {
      renderFooter({ ...HANDOFF, senderAgent: { harness: 'opencode' } });

      const chip = screen.getByTestId('timeline-sender-agent');
      expect(chip).toHaveTextContent('opencode');
      expect(chip.textContent).toBe('opencode');
      expect(screen.getByTestId('timeline-footer-agent-row')).toContainElement(chip);
    });
  });

  describe('non-handoff layout', () => {
    it('keeps the flex-wrap footer with no duration slot and no agent row', () => {
      renderFooter(makeMessage({ type: 'notice' }));

      const footer = screen.getByTestId('timeline-message-footer');
      expect(footer).toHaveClass('flex', 'flex-wrap', 'justify-between');
      expect(footer).not.toHaveClass('grid');
      expect(footer).not.toHaveAttribute('data-footer-layout');
      expect(screen.queryByTestId('timeline-handoff-duration-slot')).not.toBeInTheDocument();
      expect(screen.queryByTestId('timeline-footer-agent-row')).not.toBeInTheDocument();
    });

    it('renders a plan footer as the flex-wrap footer with the plain timestamp and no slot', () => {
      renderFooter(makeMessage({ type: 'plan' }));

      const footer = screen.getByTestId('timeline-message-footer');
      expect(footer).toHaveClass('flex', 'flex-wrap');
      expect(screen.queryByTestId('timeline-handoff-duration-slot')).not.toBeInTheDocument();
      expect(screen.queryByTestId('timeline-handoff-timestamp')).not.toBeInTheDocument();
      expect(screen.getByText('TS:1700000000000').parentElement).toHaveClass(
        ...TIMELINE_FOOTER_TIMESTAMP.split(' ')
      );
    });
  });
});

describe('TimelineMessageTimestamp', () => {
  const CREATION_TIME = 1_700_000_000_000;

  it('renders the footer timestamp markup', () => {
    render(<TimelineMessageTimestamp creationTime={CREATION_TIME} handoffDurationMs={62_000} />);

    const duration = screen.getByTestId('timeline-handoff-duration');
    expect(duration).toHaveTextContent('1m 2s');
    expect(duration).toHaveAttribute('title', 'Time since previous message: 1m 2s');
    expect(duration).toHaveAttribute('data-duration-tone', 'normal');
    expect(duration).toHaveClass('text-chatroom-text-muted');
    expect(duration).not.toHaveClass('text-chatroom-status-slow');
    expect(duration).not.toHaveClass('hidden');
    expect(duration).not.toHaveClass('sm:inline');
    expect(duration).toHaveClass('whitespace-nowrap');

    const fullDate = screen.getByText(`TS:${CREATION_TIME}`);
    expect(fullDate).toHaveAttribute('title', `TS_FULL:${CREATION_TIME}`);
  });

  it('renders a slow duration in orange with the relative tooltip', () => {
    render(
      <TimelineMessageTimestamp
        creationTime={CREATION_TIME}
        handoffDurationMs={420_000}
        handoffDurationSlow
      />
    );

    const duration = screen.getByTestId('timeline-handoff-duration');
    expect(duration).toHaveTextContent('7m 0s');
    expect(duration).toHaveAttribute(
      'title',
      'Time since previous message: 7m 0s (much longer than typical in this view)'
    );
    expect(duration).toHaveAttribute('data-duration-tone', 'slow');
    expect(duration).toHaveClass('text-chatroom-status-slow');
    expect(duration).not.toHaveClass('text-chatroom-text-muted');
  });

  it('keeps a slow duration visible at every width', () => {
    render(
      <TimelineMessageTimestamp
        creationTime={CREATION_TIME}
        handoffDurationMs={420_000}
        handoffDurationSlow
      />
    );

    const duration = screen.getByTestId('timeline-handoff-duration');
    expect(duration).toHaveClass('text-chatroom-status-slow');
    expect(duration).toHaveAttribute('data-duration-tone', 'slow');
    expect(duration).toHaveClass('whitespace-nowrap');
    expect(duration).not.toHaveClass('hidden');
    expect(duration).not.toHaveClass('sm:inline');
  });

  it('wraps the duration in the fixed slot when alignDuration is set', () => {
    render(
      <TimelineMessageTimestamp
        creationTime={CREATION_TIME}
        handoffDurationMs={62_000}
        alignDuration
      />
    );

    const slot = screen.getByTestId('timeline-handoff-duration-slot');
    expect(slot).toHaveClass('w-[7ch]', 'shrink-0', 'font-mono', 'text-[10px]');
    expect(slot).toContainElement(screen.getByTestId('timeline-handoff-duration'));
    expect(screen.getByTestId('timeline-handoff-timestamp')).toContainElement(
      screen.getByText(`TS:${CREATION_TIME}`)
    );
  });

  it('keeps the fixed 7ch duration slot in the expanded footer at every width', () => {
    render(
      <TimelineMessageTimestamp
        creationTime={CREATION_TIME}
        handoffDurationMs={62_000}
        alignDuration
      />
    );

    const slot = screen.getByTestId('timeline-handoff-duration-slot');
    expect(slot).toHaveClass('w-[7ch]');
    expect(slot).not.toHaveClass('max-sm:w-auto');
  });

  it('renders the alignDuration slot even when there is no duration', () => {
    render(<TimelineMessageTimestamp creationTime={CREATION_TIME} alignDuration />);

    expect(screen.getByTestId('timeline-handoff-duration-slot')).toBeEmptyDOMElement();
    expect(screen.queryByTestId('timeline-handoff-duration')).not.toBeInTheDocument();
    expect(screen.getByText(`TS:${CREATION_TIME}`)).toBeInTheDocument();
  });

  it.each([
    ['plain', false],
    ['alignDuration', true],
  ])('renders only the full formatTimestamp text in %s mode', (_mode, alignDuration) => {
    const { container } = render(
      <TimelineMessageTimestamp
        creationTime={CREATION_TIME}
        handoffDurationMs={62_000}
        alignDuration={alignDuration}
      />
    );

    const fullDate = screen.getByText(`TS:${CREATION_TIME}`);
    expect(fullDate).toHaveAttribute('title', `TS_FULL:${CREATION_TIME}`);
    expect(fullDate.children).toHaveLength(0);
    expect(container.querySelector('.sm\\:hidden')).toBeNull();
    expect(container.querySelector('.hidden')).toBeNull();
  });
});
