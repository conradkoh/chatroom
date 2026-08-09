import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AllTabMessageList } from './AllTabMessageList';
import { getTimelineVirtualRowZIndex } from '../../components/timeline/timelineRowStyles';
import type { TimelineMessageHeaderNavigation } from '../../components/timeline/timelineRowStyles';
import {
  JUMP_TO_NEW_MESSAGES_Z_INDEX,
  TIMELINE_PADDING_END,
} from '../../components/timeline/timelineVirtualizerConfig';
import {
  TimelineScrollResizeProvider,
  useTimelineScrollResize,
  type TimelineScrollResizeApi,
} from '../../hooks/TimelineScrollResizeContext';

vi.mock('../../components/timeline/TimelineEventRow', () => ({
  TimelineEventRow: ({
    event,
    headerNavigation,
  }: {
    event: { id: string };
    headerNavigation?: TimelineMessageHeaderNavigation;
  }) => (
    <div data-testid={`event-row-${event.id}`}>
      <button
        type="button"
        data-testid={`timeline-header-nav-first-${event.id}`}
        disabled={headerNavigation ? !headerNavigation.hasFirst : true}
        onClick={headerNavigation?.onJumpToFirst}
      />
      <button
        type="button"
        data-testid={`timeline-header-nav-previous-${event.id}`}
        disabled={headerNavigation ? !headerNavigation.hasPrevious : true}
        onClick={headerNavigation?.onJumpToPrevious}
      />
      <button
        type="button"
        data-testid={`timeline-header-nav-current-${event.id}`}
        onClick={headerNavigation?.onJumpToCurrent}
      />
      <button
        type="button"
        data-testid={`timeline-header-nav-next-${event.id}`}
        disabled={headerNavigation ? !headerNavigation.hasNext : true}
        onClick={headerNavigation?.onJumpToNext}
      />
      <button
        type="button"
        data-testid={`timeline-header-nav-last-${event.id}`}
        disabled={headerNavigation ? !headerNavigation.hasLast : true}
        onClick={headerNavigation?.onJumpToLast}
      />
      {event.id}
    </div>
  ),
}));

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

describe('scroll pinning and jump chip', () => {
  it('shows jump chip when scrolled away from bottom', () => {
    render(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 100 });
    fireEvent.scroll(list);

    expect(document.querySelector('[data-testid="all-tab-jump-to-new-messages"]')).not.toBeNull();
  });

  it('positions jump chip above timeline row z-index range when visible', () => {
    render(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 100 });
    fireEvent.scroll(list);

    const chip = document.querySelector(
      '[data-testid="all-tab-jump-to-new-messages"]'
    ) as HTMLElement;
    expect(chip).not.toBeNull();
    expect(chip.style.zIndex).toBe(String(JUMP_TO_NEW_MESSAGES_Z_INDEX));
    expect(chip.className).not.toContain('z-10');
  });

  it('hides jump chip when at bottom (pinned)', () => {
    render(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    scrollToBottom(list);

    expect(document.querySelector('[data-testid="all-tab-jump-to-new-messages"]')).toBeNull();
  });

  it('clicking jump chip scrolls to bottom and hides chip', () => {
    render(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

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
    const { rerender } = render(<AllTabMessageList events={events} anchorId="a1" />);

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
    const { rerender } = render(<AllTabMessageList events={events} anchorId="anchor-1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    list.scrollTop = 500;

    rerender(<AllTabMessageList events={events} anchorId="anchor-2" />);

    expect(list.scrollTop).toBe(0);
  });

  it('uses timeline scroll container with scrollbar width variable', () => {
    render(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);
    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    expect(list.className).toContain('min-h-0');
    expect(list.style.getPropertyValue('--timeline-scrollbar-width')).toBe('8px');
  });

  it('applies TIMELINE_PADDING_END bottom padding to the scroll container', () => {
    render(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);
    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    expect(list.style.paddingBottom).toBe(`${TIMELINE_PADDING_END}px`);
  });

  it('registers scroll resize API so composer growth does not snap mid-resize', () => {
    const apiHolder: { current: TimelineScrollResizeApi | null } = { current: null };
    function Probe() {
      apiHolder.current = useTimelineScrollResize();
      return null;
    }

    render(
      <TimelineScrollResizeProvider>
        <Probe />
        <AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />
      </TimelineScrollResizeProvider>
    );

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    // Pinned at bottom: max scrollTop = 1200 - 400 = 800
    setScrollMetrics(list, { clientHeight: 400, scrollHeight: 1200, scrollTop: 800 });
    fireEvent.scroll(list);

    expect(apiHolder.current).not.toBeNull();

    // Composer grows → feed container clientHeight shrinks → new bottom = 1200 - 300 = 900
    apiHolder.current?.beginResize();
    setScrollMetrics(list, { clientHeight: 300, scrollHeight: 1200, scrollTop: 800 });
    // Mid-resize: no snap — scrollTop must remain unchanged
    expect(list.scrollTop).toBe(800);

    apiHolder.current?.endResize();
    // Post-resize: pinned feed snaps synchronously to the new bottom
    expect(list.scrollTop).toBe(900);
  });

  it('calls onLoadMore when scrolled near the bottom and canLoadMore is true', () => {
    const onLoadMore = vi.fn();
    render(
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
    render(
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
    render(
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
    render(<AllTabMessageList events={events} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    const rowWrappers = Array.from(list.querySelectorAll('div[style]'));
    rowWrappers.forEach((wrapper, index) => {
      expect((wrapper as HTMLElement).style.zIndex).toBe(
        String(getTimelineVirtualRowZIndex(index))
      );
    });
  });

  it('renders the loading-more indicator when isLoadingMore is true', () => {
    render(
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
    render(
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
    render(<AllTabMessageList events={[makeEvent('msg-1'), makeEvent('msg-2')]} anchorId="a1" />);
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
    render(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);
    expect(document.querySelector('[data-testid="jump-to-message-top-msg-1"]')).toBeNull();
  });

  it('clicking nav-current scrolls that row to container top', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(
      document.querySelector('[data-testid="timeline-header-nav-current-msg-1"]') as HTMLElement
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 320 - 0 + 100, behavior: 'smooth' });
  });

  it('clicking nav-previous scrolls previous row', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(
      document.querySelector('[data-testid="timeline-header-nav-previous-msg-2"]') as HTMLElement
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 320 - 0 + 100, behavior: 'smooth' });
  });

  it('clicking nav-next scrolls next row', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(
      document.querySelector('[data-testid="timeline-header-nav-next-msg-1"]') as HTMLElement
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 480 - 0 + 100, behavior: 'smooth' });
  });

  it('clicking nav-first on last row scrolls to first row', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(
      document.querySelector('[data-testid="timeline-header-nav-first-msg-2"]') as HTMLElement
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 320 - 0 + 100, behavior: 'smooth' });
  });

  it('clicking nav-last on first row scrolls to last row', () => {
    const list = renderTwoEvents();

    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(
      document.querySelector('[data-testid="timeline-header-nav-last-msg-1"]') as HTMLElement
    );

    expect(scrollTo).toHaveBeenCalledWith({ top: 480 - 0 + 100, behavior: 'smooth' });
  });

  it('disables previous and first on first message, next and last on last message', () => {
    renderTwoEvents();

    expect(
      (
        document.querySelector(
          '[data-testid="timeline-header-nav-previous-msg-1"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        document.querySelector(
          '[data-testid="timeline-header-nav-first-msg-1"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        document.querySelector(
          '[data-testid="timeline-header-nav-next-msg-1"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(
      (
        document.querySelector(
          '[data-testid="timeline-header-nav-last-msg-1"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(
      (
        document.querySelector(
          '[data-testid="timeline-header-nav-previous-msg-2"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(
      (
        document.querySelector(
          '[data-testid="timeline-header-nav-first-msg-2"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(
      (
        document.querySelector(
          '[data-testid="timeline-header-nav-next-msg-2"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (
        document.querySelector(
          '[data-testid="timeline-header-nav-last-msg-2"]'
        ) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});
