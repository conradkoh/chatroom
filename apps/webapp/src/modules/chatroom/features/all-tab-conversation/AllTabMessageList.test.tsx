import { fireEvent, render, within } from '@testing-library/react';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AllTabMessageList } from './AllTabMessageList';
import { AttachmentsProvider } from '../../attachments';
import type * as TimelineEventRowModule from '../../components/timeline/TimelineEventRow';
import { getTimelineVirtualRowZIndex } from '../../components/timeline/timelineRowStyles';
import { JUMP_TO_NEW_MESSAGES_Z_INDEX } from '../../components/timeline/timelineVirtualizerConfig';

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
 * exactly when the row's props changed — which is what the All-tab list must
 * keep minimal.
 */
const { rowRenderCounts } = vi.hoisted(() => ({
  rowRenderCounts: new Map<string, number>(),
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

type HeaderNavControl = 'first' | 'previous' | 'current' | 'next' | 'last';

/** Scopes to one rendered row, since the real header nav reuses test ids per row. */
function headerNav(messageId: string, control: HeaderNavControl): HTMLButtonElement {
  const row = document.querySelector(`[data-testid="event-row-${messageId}"]`);
  if (!row) throw new Error(`row ${messageId} is not rendered`);
  return within(row as HTMLElement).getByTestId(
    `timeline-header-nav-${control}`
  ) as HTMLButtonElement;
}

describe('scroll pinning and jump chip', () => {
  it('shows jump chip when scrolled away from bottom', () => {
    renderList(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 100 });
    fireEvent.scroll(list);

    expect(document.querySelector('[data-testid="all-tab-jump-to-new-messages"]')).not.toBeNull();
  });

  it('positions jump chip above contained timeline rows with long feed', () => {
    const events = Array.from({ length: 40 }, (_, index) => makeEvent(`msg-${index}`));
    renderList(<AllTabMessageList events={events} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    expect(list).toHaveClass('relative', 'z-0');
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 100 });
    fireEvent.scroll(list);

    const chip = document.querySelector(
      '[data-testid="all-tab-jump-to-new-messages"]'
    ) as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.style.zIndex).toBe(String(JUMP_TO_NEW_MESSAGES_Z_INDEX));
    expect(JUMP_TO_NEW_MESSAGES_Z_INDEX).toBe(20);
  });

  it('hides jump chip when at bottom (pinned)', () => {
    renderList(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    scrollToBottom(list);

    expect(document.querySelector('[data-testid="all-tab-jump-to-new-messages"]')).toBeNull();
  });

  it('clicking jump chip scrolls to bottom and hides chip', () => {
    renderList(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 100 });
    fireEvent.scroll(list);

    const chip = document.querySelector('[data-testid="all-tab-jump-to-new-messages"]');
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
    expect(document.querySelector('[data-testid="all-tab-jump-to-new-messages"]')).toBeNull();
  });

  it('dispatches scroll on anchorId change to unpin', () => {
    const events = [makeEvent('msg-1')];
    const { rerender } = renderList(<AllTabMessageList events={events} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 800 });

    rerender(<AllTabMessageList events={events} anchorId="a2" />);

    expect(list.scrollTop).toBe(0);
    expect(document.querySelector('[data-testid="all-tab-jump-to-new-messages"]')).not.toBeNull();
  });
});

describe('AllTabMessageList', () => {
  it('scrolls to top when anchorId changes', () => {
    const events = [makeEvent('msg-1')];
    const { rerender } = renderList(<AllTabMessageList events={events} anchorId="anchor-1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    list.scrollTop = 500;

    rerender(<AllTabMessageList events={events} anchorId="anchor-2" />);

    expect(list.scrollTop).toBe(0);
  });

  it('uses timeline scroll container with scrollbar width variable', () => {
    renderList(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);
    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    expect(list.className).toContain('min-h-0');
    expect(list.style.getPropertyValue('--timeline-scrollbar-width')).toBe('8px');
  });

  it('calls onLoadMore when scrolled near the bottom and canLoadMore is true', () => {
    const onLoadMore = vi.fn();
    renderList(
      <AllTabMessageList
        events={[makeEvent('msg-1'), makeEvent('msg-2')]}
        anchorId="a1"
        canLoadMore
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    onLoadMore.mockClear();
    scrollToBottom(list);

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('does not call onLoadMore when canLoadMore is false', () => {
    const onLoadMore = vi.fn();
    renderList(
      <AllTabMessageList
        events={[makeEvent('msg-1')]}
        anchorId="a1"
        canLoadMore={false}
        isLoadingMore={false}
        onLoadMore={onLoadMore}
      />
    );

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    scrollToBottom(list);

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('does not call onLoadMore while already loading more', () => {
    const onLoadMore = vi.fn();
    renderList(
      <AllTabMessageList
        events={[makeEvent('msg-1')]}
        anchorId="a1"
        canLoadMore
        isLoadingMore
        onLoadMore={onLoadMore}
      />
    );

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    scrollToBottom(list);

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('applies ascending z-index to row wrappers for sticky header stacking', () => {
    const events = [makeEvent('msg-1'), makeEvent('msg-2'), makeEvent('msg-3')];
    renderList(<AllTabMessageList events={events} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    const rowWrappers = Array.from(list.querySelectorAll('div[style]'));
    rowWrappers.forEach((wrapper, index) => {
      expect((wrapper as HTMLElement).style.zIndex).toBe(
        String(getTimelineVirtualRowZIndex(index))
      );
    });
  });

  it('renders the loading-more indicator when isLoadingMore is true', () => {
    renderList(
      <AllTabMessageList
        events={[makeEvent('msg-1')]}
        anchorId="a1"
        isLoadingMore
        onLoadMore={vi.fn()}
      />
    );

    expect(document.querySelector('[data-testid="all-tab-loading-more"]')).not.toBeNull();
  });

  it('does not render the loading-more indicator when not loading more', () => {
    renderList(
      <AllTabMessageList
        events={[makeEvent('msg-1')]}
        anchorId="a1"
        isLoadingMore={false}
        onLoadMore={vi.fn()}
      />
    );

    expect(document.querySelector('[data-testid="all-tab-loading-more"]')).toBeNull();
  });
});

describe('sticky header message navigation', () => {
  function renderTwoEvents() {
    renderList(
      <AllTabMessageList events={[makeEvent('msg-1'), makeEvent('msg-2')]} anchorId="a1" />
    );
    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;

    list.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 400,
        left: 0,
        right: 0,
        x: 0,
        y: 0,
        width: 100,
        height: 400,
        toJSON: () => ({}),
      }) as DOMRect;

    const msg1Row = list.querySelector('[data-message-id="msg-1"]') as HTMLElement;
    const msg2Row = list.querySelector('[data-message-id="msg-2"]') as HTMLElement;
    msg1Row.getBoundingClientRect = () =>
      ({
        top: 320,
        bottom: 400,
        left: 0,
        right: 0,
        x: 0,
        y: 320,
        width: 100,
        height: 80,
        toJSON: () => ({}),
      }) as DOMRect;
    msg2Row.getBoundingClientRect = () =>
      ({
        top: 480,
        bottom: 560,
        left: 0,
        right: 0,
        x: 0,
        y: 480,
        width: 100,
        height: 80,
        toJSON: () => ({}),
      }) as DOMRect;
    Object.defineProperty(list, 'scrollTop', { value: 100, writable: true, configurable: true });

    return list;
  }

  it('does not render per-row chevron jump buttons', () => {
    renderList(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);
    expect(document.querySelector('[data-testid="jump-to-message-top-msg-1"]')).toBeNull();
  });

  it('clicking nav-current scrolls that row to container top', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(headerNav('msg-1', 'current'));

    expect(scrollTo).toHaveBeenCalledWith({ top: 320 - 0 + 100, behavior: 'smooth' });
  });

  it('clicking nav-previous scrolls previous row', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(headerNav('msg-2', 'previous'));

    expect(scrollTo).toHaveBeenCalledWith({ top: 320 - 0 + 100, behavior: 'smooth' });
  });

  it('clicking nav-next scrolls next row', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(headerNav('msg-1', 'next'));

    expect(scrollTo).toHaveBeenCalledWith({ top: 480 - 0 + 100, behavior: 'smooth' });
  });

  it('clicking nav-first on last row scrolls to first row', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(headerNav('msg-2', 'first'));

    expect(scrollTo).toHaveBeenCalledWith({ top: 320 - 0 + 100, behavior: 'smooth' });
  });

  it('clicking nav-last on first row scrolls to last row', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(headerNav('msg-1', 'last'));

    expect(scrollTo).toHaveBeenCalledWith({ top: 480 - 0 + 100, behavior: 'smooth' });
  });

  it('disables previous and first on first message, next and last on last message', () => {
    renderTwoEvents();

    expect(headerNav('msg-1', 'previous').disabled).toBe(true);
    expect(headerNav('msg-1', 'first').disabled).toBe(true);
    expect(headerNav('msg-1', 'next').disabled).toBe(false);
    expect(headerNav('msg-1', 'last').disabled).toBe(false);

    expect(headerNav('msg-2', 'previous').disabled).toBe(false);
    expect(headerNav('msg-2', 'first').disabled).toBe(false);
    expect(headerNav('msg-2', 'next').disabled).toBe(true);
    expect(headerNav('msg-2', 'last').disabled).toBe(true);
  });
});

describe('row re-render behavior', () => {
  beforeEach(() => {
    rowRenderCounts.clear();
  });

  it('does not invoke TimelineEventRow when the events array identity changes only', () => {
    const events = [makeEvent('msg-1'), makeEvent('msg-2')];
    const { rerender } = renderList(<AllTabMessageList events={events} anchorId="a1" />);
    rowRenderCounts.clear();

    rerender(<AllTabMessageList events={[...events]} anchorId="a1" />);

    expect([...rowRenderCounts.keys()]).toEqual([]);
  });

  it('invokes TimelineEventRow only for the row whose event object changed', () => {
    const events = [makeEvent('msg-1'), makeEvent('msg-2')];
    const { rerender } = renderList(<AllTabMessageList events={events} anchorId="a1" />);
    rowRenderCounts.clear();

    rerender(
      <AllTabMessageList events={[events[0], { ...events[1], creationTime: 200 }]} anchorId="a1" />
    );

    expect([...rowRenderCounts.keys()]).toEqual(['msg-2']);
  });
});
