import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationMessageList } from './ConversationMessageList';
import { AttachmentsProvider } from '../../attachments';
import type * as TimelineEventRowModule from '../../components/timeline/TimelineEventRow';
import { getTimelineVirtualRowZIndex } from '../../components/timeline/timelineRowStyles';
import { JUMP_TO_NEW_MESSAGES_Z_INDEX } from '../../components/timeline/timelineVirtualizerConfig';
import { mapMessageToTimelineEvent } from '../../timeline/mapMessageToTimelineEvent';
import type { Message } from '../../types/message';

// matchMedia polyfill needed by useIsDesktop (used by MessageDownloadMenu in the real row).
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

/**
 * Render-counting wrapper around the real `TimelineEventRow`.
 *
 * The wrapper is `memo`-ized like the real component, so a count is recorded
 * exactly when the row's props changed — which is what the conversation list must
 * keep minimal.
 */
const { rowRenderCounts } = vi.hoisted(() => ({
  rowRenderCounts: new Map<string, number>(),
}));

/**
 * Markdown render counter. Eager rows (user messages, user-facing handoffs) run
 * the real markdown body, so counting its calls proves which rows re-ran the
 * expensive render path after an append.
 */
const { markdownRenderMock } = vi.hoisted(() => ({ markdownRenderMock: vi.fn() }));

vi.mock('../../components/timeline/TimelineMarkdownBody', () => ({
  TimelineMarkdownBody: ({ content }: { content: string }) => {
    markdownRenderMock(content);
    return (
      <div className="prose" data-testid="timeline-markdown-body">
        {content
          .split('\n')
          .filter((line) => line.trim())
          .map((line, index) => (
            <p key={index}>{line}</p>
          ))}
      </div>
    );
  },
}));

vi.mock('../../components/timeline/TimelineEventRow', async (importOriginal) => {
  const actual = await importOriginal<typeof TimelineEventRowModule>();
  const { memo } = await import('react');
  return {
    TimelineEventRow: memo(function CountingTimelineEventRow(
      props: Parameters<typeof actual.TimelineEventRow>[0]
    ) {
      rowRenderCounts.set(props.event.id, (rowRenderCounts.get(props.event.id) ?? 0) + 1);
      return (
        <div data-testid={`event-row-${props.event.id}`}>
          <actual.TimelineEventRow {...props} />
        </div>
      );
    }),
  };
});

const makeEvent = (id: string) => ({
  id,
  kind: 'user_message' as const,
  creationTime: 100,
  message: {
    _id: id,
    content: id,
    type: 'message' as const,
    senderRole: 'user' as const,
    _creationTime: 100,
  },
});

function setScrollMetrics(
  el: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number }
) {
  Object.defineProperty(el, 'clientHeight', { value: metrics.clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, 'scrollTop', {
    value: metrics.scrollTop,
    writable: true,
    configurable: true,
  });
}

function scrollToBottom(el: HTMLElement) {
  setScrollMetrics(el, { clientHeight: 400, scrollHeight: 1200, scrollTop: 1000 });
  fireEvent.scroll(el);
}

/** The real row renders attachment chips / footer, which need the provider. */
function renderList(ui: React.ReactElement) {
  return render(ui, { wrapper: AttachmentsProvider });
}

describe('scroll pinning and jump chip', () => {
  it('shows jump chip when scrolled away from bottom', () => {
    renderList(<ConversationMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 100 });
    fireEvent.scroll(list);

    expect(
      document.querySelector('[data-testid="conversation-jump-to-new-messages"]')
    ).not.toBeNull();
  });

  it('positions jump chip above contained timeline rows with long feed', () => {
    const events = Array.from({ length: 40 }, (_, index) => makeEvent(`msg-${index}`));
    renderList(<ConversationMessageList events={events} anchorId="a1" />);

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    expect(list).toHaveClass('relative', 'z-0');
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 100 });
    fireEvent.scroll(list);

    const chip = document.querySelector(
      '[data-testid="conversation-jump-to-new-messages"]'
    ) as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.style.zIndex).toBe(String(JUMP_TO_NEW_MESSAGES_Z_INDEX));
    expect(JUMP_TO_NEW_MESSAGES_Z_INDEX).toBe(20);
  });

  it('hides jump chip when at bottom (pinned)', () => {
    renderList(<ConversationMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    scrollToBottom(list);

    expect(document.querySelector('[data-testid="conversation-jump-to-new-messages"]')).toBeNull();
  });

  it('clicking jump chip scrolls to bottom and hides chip', () => {
    renderList(<ConversationMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 100 });
    fireEvent.scroll(list);

    const chip = document.querySelector('[data-testid="conversation-jump-to-new-messages"]');
    expect(chip).not.toBeNull();

    const scrollTo = vi.fn((opts?: ScrollToOptions | number) => {
      if (opts && typeof opts === 'object' && typeof opts.top === 'number') {
        Object.defineProperty(list, 'scrollTop', {
          value: opts.top,
          writable: true,
          configurable: true,
        });
      }
    });
    list.scrollTo = scrollTo;

    fireEvent.click(chip as HTMLElement);

    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'smooth' });
    expect(list.scrollTop).toBe(1200);
    expect(document.querySelector('[data-testid="conversation-jump-to-new-messages"]')).toBeNull();
  });

  it('dispatches scroll on anchorId change to unpin', () => {
    const events = [makeEvent('msg-1')];
    const { rerender } = renderList(<ConversationMessageList events={events} anchorId="a1" />);

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 800 });

    rerender(<ConversationMessageList events={events} anchorId="a2" />);

    expect(list.scrollTop).toBe(0);
    expect(
      document.querySelector('[data-testid="conversation-jump-to-new-messages"]')
    ).not.toBeNull();
  });
});

describe('ConversationMessageList', () => {
  it('scrolls to top when anchorId changes', () => {
    const events = [makeEvent('msg-1')];
    const { rerender } = renderList(
      <ConversationMessageList events={events} anchorId="anchor-1" />
    );

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    list.scrollTop = 500;

    rerender(<ConversationMessageList events={events} anchorId="anchor-2" />);

    expect(list.scrollTop).toBe(0);
  });

  it('uses timeline scroll container with scrollbar width variable', () => {
    renderList(<ConversationMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);
    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    expect(list.className).toContain('min-h-0');
    expect(list.style.getPropertyValue('--timeline-scrollbar-width')).toBe('8px');
  });

  it('calls onLoadMore when scrolled near the bottom and canLoadMore is true', () => {
    const onLoadMore = vi.fn();
    renderList(
      <ConversationMessageList
        events={[makeEvent('msg-1'), makeEvent('msg-2')]}
        anchorId="a1"
        canLoadMore
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    onLoadMore.mockClear();
    scrollToBottom(list);

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not call onLoadMore when canLoadMore is false', () => {
    const onLoadMore = vi.fn();
    renderList(
      <ConversationMessageList
        events={[makeEvent('msg-1')]}
        anchorId="a1"
        canLoadMore={false}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    scrollToBottom(list);

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not call onLoadMore while already loading more', () => {
    const onLoadMore = vi.fn();
    renderList(
      <ConversationMessageList
        events={[makeEvent('msg-1')]}
        anchorId="a1"
        canLoadMore
        isLoadingMore
        onLoadMore={onLoadMore}
      />
    );

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    scrollToBottom(list);

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('applies ascending z-index to row wrappers for sticky header stacking', () => {
    const events = [makeEvent('msg-1'), makeEvent('msg-2'), makeEvent('msg-3')];
    renderList(<ConversationMessageList events={events} anchorId="a1" />);

    const list = document.querySelector(
      '[data-testid="conversation-message-list"]'
    ) as HTMLDivElement;
    const rowWrappers = Array.from(list.querySelectorAll('div[style]'));
    rowWrappers.forEach((wrapper, index) => {
      expect((wrapper as HTMLElement).style.zIndex).toBe(
        String(getTimelineVirtualRowZIndex(index))
      );
    });
  });

  it('renders the loading-more indicator when isLoadingMore is true', () => {
    renderList(
      <ConversationMessageList
        events={[makeEvent('msg-1')]}
        anchorId="a1"
        isLoadingMore
        onLoadMore={vi.fn()}
      />
    );

    expect(document.querySelector('[data-testid="conversation-loading-more"]')).not.toBeNull();
  });

  it('does not render the loading-more indicator when not loading more', () => {
    renderList(
      <ConversationMessageList
        events={[makeEvent('msg-1')]}
        anchorId="a1"
        isLoadingMore={false}
        onLoadMore={vi.fn()}
      />
    );

    expect(document.querySelector('[data-testid="conversation-loading-more"]')).toBeNull();
  });
});

describe('handoff collapse behavior', () => {
  const AGENT_HANDOFF_BODY = 'Preview line one.\nPreview line two.\n\nDeferred body sentence.';

  const MESSAGES: Message[] = [
    {
      _id: 'user-1',
      type: 'message',
      senderRole: 'user',
      content: 'User message body.',
      _creationTime: 1,
    },
    {
      _id: 'handoff-1',
      type: 'handoff',
      senderRole: 'builder',
      targetRole: 'planner',
      content: AGENT_HANDOFF_BODY,
      _creationTime: 2,
    },
    {
      _id: 'handoff-user-1',
      type: 'handoff',
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Handoff to user body.',
      _creationTime: 3,
    },
    {
      _id: 'notice-1',
      type: 'notice',
      senderRole: 'builder',
      targetRole: 'user',
      content: 'Notice body.',
      _creationTime: 4,
    },
  ];

  function renderTimeline() {
    const events = MESSAGES.map((message) => mapMessageToTimelineEvent(message));
    return renderList(<ConversationMessageList events={events} anchorId="a1" />);
  }

  function row(messageId: string): HTMLElement {
    const el = document.querySelector(`[data-testid="event-row-${messageId}"]`);
    if (!el) throw new Error(`row ${messageId} is not rendered`);
    return el as HTMLElement;
  }

  it('collapses agent-to-agent handoffs to a summary bar', () => {
    renderTimeline();
    const agentRow = row('handoff-1');
    const trigger = within(agentRow).getByTestId('timeline-handoff-trigger');

    expect(within(trigger).getByTestId('timeline-handoff-preview')).toHaveTextContent(
      'Preview line one. Preview line two.'
    );
    expect(within(agentRow).queryByText('Deferred body sentence.')).not.toBeInTheDocument();
    expect(agentRow.querySelector('.prose')).toBeNull();
    // The sticky header and row identity survive; the footer does not render.
    expect(within(agentRow).getByTestId('timeline-message-header')).toBeInTheDocument();
    expect(within(agentRow).queryByTestId('timeline-message-footer')).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-message-id="handoff-1"]')).toHaveLength(1);
  });

  it('renders no per-message navigation controls on any row', () => {
    renderTimeline();
    expect(
      document.querySelector(
        '[data-testid^="timeline-header-nav"], [data-testid="timeline-message-header-nav"]'
      )
    ).toBeNull();
    expect(
      document.querySelectorAll('[data-testid="timeline-message-header"]').length
    ).toBeGreaterThan(0);
  });

  it('keeps user, agent-to-user handoffs, and notices expanded', () => {
    renderTimeline();

    for (const [messageId, text] of [
      ['user-1', 'User message body.'],
      ['handoff-user-1', 'Handoff to user body.'],
      ['notice-1', 'Notice body.'],
    ] as const) {
      const eagerRow = row(messageId);
      expect(within(eagerRow).getByText(text)).toBeInTheDocument();
      expect(eagerRow.querySelector('.prose')).not.toBeNull();
      expect(within(eagerRow).queryByTestId('timeline-handoff-preview')).not.toBeInTheDocument();
      expect(within(eagerRow).queryByText('Show full handoff')).not.toBeInTheDocument();
    }
  });

  it('opens the full handoff in a dialog when Show full handoff is clicked', () => {
    renderTimeline();
    const agentRow = row('handoff-1');

    fireEvent.click(within(agentRow).getByRole('button', { name: 'Show full handoff' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Deferred body sentence.')).toBeInTheDocument();
    expect(within(dialog).getByTestId('timeline-message-footer')).toBeInTheDocument();
    // The summary bar is unchanged: the row does not mount the body or the footer.
    expect(within(row('handoff-1')).getByTestId('timeline-handoff-preview')).toBeInTheDocument();
    expect(
      within(row('handoff-1')).queryByTestId('timeline-message-footer')
    ).not.toBeInTheDocument();
    expect(document.querySelectorAll('[data-message-id="handoff-1"]')).toHaveLength(1);
  });
});

describe('row re-render behavior', () => {
  beforeEach(() => {
    rowRenderCounts.clear();
    markdownRenderMock.mockClear();
  });

  it('does not invoke TimelineEventRow when the events array identity changes only', () => {
    const events = [makeEvent('msg-1'), makeEvent('msg-2')];
    const { rerender } = renderList(<ConversationMessageList events={events} anchorId="a1" />);
    rowRenderCounts.clear();

    rerender(<ConversationMessageList events={[...events]} anchorId="a1" />);

    expect([...rowRenderCounts.keys()]).toEqual([]);
  });

  it('invokes TimelineEventRow only for the row whose event object changed', () => {
    const events = [makeEvent('msg-1'), makeEvent('msg-2')];
    const { rerender } = renderList(<ConversationMessageList events={events} anchorId="a1" />);
    rowRenderCounts.clear();

    rerender(
      <ConversationMessageList
        events={[events[0], { ...events[1], creationTime: 200 }]}
        anchorId="a1"
      />
    );

    expect([...rowRenderCounts.keys()]).toEqual(['msg-2']);
  });

  it('re-renders only the appended row on append', () => {
    const events = [makeEvent('a'), makeEvent('b'), makeEvent('c')];
    const { rerender } = renderList(<ConversationMessageList events={events} anchorId="a1" />);
    rowRenderCounts.clear();
    markdownRenderMock.mockClear();

    rerender(<ConversationMessageList events={[...events, makeEvent('d')]} anchorId="a1" />);

    // Existing rows keep their event object and index, so only the appended row `d` renders.
    expect([...rowRenderCounts.keys()]).toEqual(['d']);
    expect(markdownRenderMock.mock.calls.map(([content]) => content)).toEqual(['d']);
  });
});

describe('jump to top button', () => {
  const baseMatchMedia = window.matchMedia;

  function renderLongFeed(events = Array.from({ length: 40 }, (_, i) => makeEvent(`msg-${i}`))) {
    const result = renderList(<ConversationMessageList events={events} anchorId="a1" />);
    const list = document.querySelector('[data-testid="conversation-message-list"]') as HTMLElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 3000, scrollTop: 0 });
    return { ...result, list };
  }

  function scrollList(list: HTMLElement, scrollTop: number) {
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 3000, scrollTop });
    fireEvent.scroll(list);
  }

  function userScrollList(
    list: HTMLElement,
    scrollTop: number,
    via: 'wheel' | 'keydown' = 'wheel'
  ) {
    if (via === 'wheel') fireEvent.wheel(list);
    else fireEvent.keyDown(list, { key: 'ArrowUp' });
    scrollList(list, scrollTop);
  }

  function jumpButton() {
    return document.querySelector('[data-testid="conversation-jump-to-top"]');
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.matchMedia = baseMatchMedia;
  });

  it('hidden after mount', () => {
    renderLongFeed();
    expect(jumpButton()).toBeNull();
  });

  it('hidden after a small upward scroll', () => {
    const { list } = renderLongFeed();
    scrollList(list, 1000);
    userScrollList(list, 950);
    expect(jumpButton()).toBeNull();
  });

  it('visible after an 80px upward scroll, focus stays put', () => {
    const { list } = renderLongFeed();
    scrollList(list, 1000);
    userScrollList(list, 920);

    const button = screen.getByRole('button', { name: 'Jump to top' });
    expect(button).toBeInTheDocument();
    expect(document.activeElement).not.toBe(button);
  });

  it('not shown for an upward scroll that ends at scrollTop <= 200', () => {
    const { list } = renderLongFeed();
    scrollList(list, 250);
    userScrollList(list, 150);
    expect(jumpButton()).toBeNull();
  });

  it('a feed that shrinks to non-scrollable never shows the button', () => {
    const { list, rerender } = renderLongFeed(); // 40 events, scrollHeight 3000
    scrollList(list, 1000); // lastTop 1000, no user input
    rerender(<ConversationMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 400, scrollTop: 0 });
    fireEvent.wheel(list);
    fireEvent.scroll(list); // clamp to 0 after the user's wheel
    expect(jumpButton()).toBeNull();
  });

  it('auto-hides 3000 ms after the last upward move', () => {
    const { list } = renderLongFeed();
    scrollList(list, 1000);
    userScrollList(list, 920);
    expect(jumpButton()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(jumpButton()).toBeNull();
  });

  it('hides after 40px of downward scroll', () => {
    const { list } = renderLongFeed();
    scrollList(list, 1000);
    userScrollList(list, 920);
    expect(jumpButton()).not.toBeNull();

    scrollList(list, 960);
    expect(jumpButton()).toBeNull();
  });

  it('click scrolls to top smoothly, hides the button, and does not re-show during the smooth scroll', () => {
    const { list } = renderLongFeed();
    Object.defineProperty(list, 'scrollTo', { value: vi.fn(), configurable: true });
    scrollList(list, 1000);
    userScrollList(list, 920);

    const button = screen.getByRole('button', { name: 'Jump to top' });
    fireEvent.click(button);

    expect(list.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    expect(jumpButton()).toBeNull();

    scrollList(list, 900);
    scrollList(list, 800);
    scrollList(list, 700);
    expect(jumpButton()).toBeNull();
    expect(document.activeElement).toBe(list);
  });

  it('click uses instant scroll under reduced motion', () => {
    const { list } = renderLongFeed();
    Object.defineProperty(list, 'scrollTo', { value: vi.fn(), configurable: true });
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    scrollList(list, 1000);
    userScrollList(list, 920);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to top' }));

    expect(list.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('hover pauses the timer', () => {
    const { list } = renderLongFeed();
    scrollList(list, 1000);
    userScrollList(list, 920);
    const button = screen.getByRole('button', { name: 'Jump to top' });

    fireEvent.mouseEnter(button);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(jumpButton()).not.toBeNull();

    fireEvent.mouseLeave(button);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(jumpButton()).toBeNull();
  });

  it('focus pauses the timer', () => {
    const { list } = renderLongFeed();
    scrollList(list, 1000);
    userScrollList(list, 920);
    const button = screen.getByRole('button', { name: 'Jump to top' });

    fireEvent.focus(button);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(jumpButton()).not.toBeNull();

    fireEvent.blur(button);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(jumpButton()).toBeNull();
  });

  it('focus and hover holds are independent, so leaving with the mouse keeps the focused button', () => {
    const { list } = renderLongFeed();
    scrollList(list, 1000);
    userScrollList(list, 920);
    const button = screen.getByRole('button', { name: 'Jump to top' });

    fireEvent.focus(button);
    fireEvent.mouseEnter(button);
    fireEvent.mouseLeave(button);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(jumpButton()).not.toBeNull();

    fireEvent.blur(button);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(jumpButton()).toBeNull();
  });

  it('keyboard input releases suppression after a click', () => {
    const { list } = renderLongFeed();
    Object.defineProperty(list, 'scrollTo', { value: vi.fn(), configurable: true });
    scrollList(list, 1000);
    userScrollList(list, 920);
    fireEvent.click(screen.getByRole('button', { name: 'Jump to top' }));
    expect(jumpButton()).toBeNull();

    fireEvent.keyDown(list, { key: 'ArrowDown' });
    userScrollList(list, 900, 'keydown');
    userScrollList(list, 800, 'keydown');
    expect(jumpButton()).not.toBeNull();
  });

  it('anchor change hides it', () => {
    const events = Array.from({ length: 40 }, (_, i) => makeEvent(`msg-${i}`));
    const { rerender } = renderList(<ConversationMessageList events={events} anchorId="a1" />);
    const list = document.querySelector('[data-testid="conversation-message-list"]') as HTMLElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 3000, scrollTop: 0 });
    scrollList(list, 1000);
    userScrollList(list, 920);
    expect(jumpButton()).not.toBeNull();

    // The list's anchor effect writes scrollTop = 0; pin it so that write cannot move the
    // position and the hide can only come from the hook's resetKey effect.
    Object.defineProperty(list, 'scrollTop', {
      get: () => 920,
      set: () => {},
      configurable: true,
    });
    rerender(<ConversationMessageList events={events} anchorId="a2" />);
    expect(jumpButton()).toBeNull();
  });

  it('Jump to new messages hides the button', () => {
    const { list } = renderLongFeed();
    scrollList(list, 1000);
    userScrollList(list, 920);
    expect(jumpButton()).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(200); // let the scroll controller mark the feed unpinned
    });

    Object.defineProperty(list, 'scrollTo', {
      value: vi.fn(() => {
        setScrollMetrics(list, { clientHeight: 400, scrollHeight: 3000, scrollTop: 3000 });
        fireEvent.scroll(list);
      }),
      configurable: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Jump to new messages' }));
    expect(jumpButton()).toBeNull();
  });

  it('coexists with the jump-to-new-messages chip', () => {
    const { list } = renderLongFeed();
    scrollList(list, 1000);
    userScrollList(list, 900);
    act(() => {
      vi.advanceTimersByTime(200); // let the scroll controller mark the feed unpinned
    });

    const top = document.querySelector(
      '[data-testid="conversation-jump-to-top"]'
    ) as HTMLElement | null;
    const chip = document.querySelector(
      '[data-testid="conversation-jump-to-new-messages"]'
    ) as HTMLElement | null;

    expect(top).not.toBeNull();
    expect(chip).not.toBeNull();
    expect(chip?.style.zIndex).toBe(top?.style.zIndex);
    expect(chip?.style.zIndex).toBe(String(JUMP_TO_NEW_MESSAGES_Z_INDEX));
    expect(chip?.className).toContain('left-1/2');
    expect(top?.className).toContain('right-3');
  });

  it('renders neither control for an empty feed', () => {
    renderList(<ConversationMessageList events={[]} anchorId="a1" />);
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="conversation-jump-to-top"]')).toBeNull();
    expect(document.querySelector('[data-testid="conversation-jump-to-new-messages"]')).toBeNull();
  });
});

describe('tall pinned plan arrival', () => {
  const PLAN_CONTENT = [
    '# Arrival plan',
    '',
    '## Sources',
    '',
    '- None.',
    '',
    '## Requirements',
    '',
    '- Land on the title.',
    '',
    '## Constraints',
    '',
    '- None.',
    '',
    '## Phases',
    '',
    '- P1 — One',
    '',
    '## Phase details',
    '',
    '### P1 — One',
    '',
    '#### Requirements',
    '',
    '- Land on the title.',
    '',
    '#### Constraints',
    '',
    '- None.',
    '',
    '#### Acceptance criteria',
    '',
    '- Arrival works.',
  ].join('\n');

  /** Geometry stubs: jsdom has no layout, so height and offsets are the external port. */
  let container: { clientHeight: number; scrollHeight: number; scrollTop: number };
  let rows: Record<string, { offsetHeight: number; offsetTop: number }>;

  const originalDescriptors = {
    scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
    scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop'),
    offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
    offsetTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop'),
  };

  beforeEach(() => {
    container = { clientHeight: 400, scrollHeight: 800, scrollTop: 400 };
    rows = {};
    const isContainer = (el: HTMLElement) => el.dataset.testid === 'conversation-message-list';
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return isContainer(this) ? container.scrollHeight : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return isContainer(this) ? container.clientHeight : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      configurable: true,
      get(this: HTMLElement) {
        return isContainer(this) ? container.scrollTop : 0;
      },
      set(this: HTMLElement, value: number) {
        if (isContainer(this)) container.scrollTop = value;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get(this: HTMLElement) {
        const id = this.dataset.messageId;
        return id ? (rows[id]?.offsetHeight ?? 0) : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        const id = this.dataset.messageId;
        return id ? (rows[id]?.offsetTop ?? 0) : 0;
      },
    });
  });

  afterEach(() => {
    if (originalDescriptors.scrollHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'scrollHeight',
        originalDescriptors.scrollHeight
      );
    }
    if (originalDescriptors.clientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'clientHeight',
        originalDescriptors.clientHeight
      );
    }
    if (originalDescriptors.scrollTop) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalDescriptors.scrollTop);
    }
    if (originalDescriptors.offsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        'offsetHeight',
        originalDescriptors.offsetHeight
      );
    }
    if (originalDescriptors.offsetTop) {
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalDescriptors.offsetTop);
    }
  });

  const userEvent = mapMessageToTimelineEvent({
    _id: 'user-1',
    type: 'message',
    senderRole: 'user',
    content: 'Hello',
    _creationTime: 1,
  });
  const planEvent = mapMessageToTimelineEvent({
    _id: 'plan-tall',
    type: 'plan',
    senderRole: 'specifier',
    content: PLAN_CONTENT,
    _creationTime: 2,
  });
  const tallHandoffEvent = mapMessageToTimelineEvent({
    _id: 'handoff-tall',
    type: 'handoff',
    senderRole: 'builder',
    targetRole: 'planner',
    content: 'Tall handoff',
    _creationTime: 3,
  });

  function listEl() {
    return document.querySelector<HTMLElement>('[data-testid="conversation-message-list"]')!;
  }

  /** Render one event, let the mount effects settle, then pin to the bottom. */
  function renderPinned() {
    const result = renderList(<ConversationMessageList events={[userEvent]} anchorId="a1" />);
    const list = listEl();
    container.scrollTop = 400;
    fireEvent.scroll(list);
    return { ...result, list };
  }

  function jumpChip() {
    return document.querySelector('[data-testid="conversation-jump-to-new-messages"]');
  }

  it('opens an appended tall plan at its title when pinned', () => {
    const { rerender } = renderPinned();
    rows['plan-tall'] = { offsetHeight: 2000, offsetTop: 350 };
    container.scrollHeight = 1600;

    rerender(<ConversationMessageList events={[userEvent, planEvent]} anchorId="a1" />);

    expect(listEl().scrollTop).toBe(350);
    expect(jumpChip()).toBeNull();

    fireEvent.scroll(listEl());

    expect(listEl().scrollTop).toBe(350);
    expect(jumpChip()).not.toBeNull();
  });

  it('snaps to the bottom for an appended plan shorter than the viewport', () => {
    const { rerender } = renderPinned();
    rows['plan-tall'] = { offsetHeight: 100, offsetTop: 350 };
    container.scrollHeight = 1600;

    rerender(<ConversationMessageList events={[userEvent, planEvent]} anchorId="a1" />);

    expect(listEl().scrollTop).toBe(1200);
  });

  it('leaves the position alone for an appended tall plan when unpinned', () => {
    const { rerender } = renderList(<ConversationMessageList events={[userEvent]} anchorId="a1" />);
    // Mount parked the feed at the top; the feed is unpinned.
    container.scrollTop = 120;
    fireEvent.wheel(listEl());
    fireEvent.scroll(listEl());
    rows['plan-tall'] = { offsetHeight: 2000, offsetTop: 350 };
    container.scrollHeight = 1600;

    rerender(<ConversationMessageList events={[userEvent, planEvent]} anchorId="a1" />);

    expect(listEl().scrollTop).toBe(120);
  });

  it('snaps to the bottom for an appended tall non-plan row when pinned', () => {
    const { rerender } = renderPinned();
    rows['handoff-tall'] = { offsetHeight: 2000, offsetTop: 350 };
    container.scrollHeight = 1600;

    rerender(<ConversationMessageList events={[userEvent, tallHandoffEvent]} anchorId="a1" />);

    expect(listEl().scrollTop).toBe(1200);
  });
});
