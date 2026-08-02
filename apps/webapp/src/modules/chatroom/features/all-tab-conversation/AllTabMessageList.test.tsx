import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AllTabMessageList } from './AllTabMessageList';
import { getTimelineVirtualRowZIndex } from '../../components/timeline/timelineRowStyles';

vi.mock('../../components/timeline/TimelineEventRow', () => ({
  TimelineEventRow: ({
    event,
    onHeaderClick,
  }: {
    event: { id: string };
    onHeaderClick?: () => void;
  }) => (
    <div data-testid={`event-row-${event.id}`}>
      <div data-testid="timeline-message-header" onClick={onHeaderClick} />
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

describe('sticky header jump to top', () => {
  it('does not render per-row chevron jump buttons', () => {
    render(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);
    expect(document.querySelector('[data-testid="jump-to-message-top-msg-1"]')).toBeNull();
  });

  it('clicking timeline-message-header scrolls that row to container top', () => {
    render(<AllTabMessageList events={[makeEvent('msg-1')]} anchorId="a1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    const row = list.querySelector('[data-message-id="msg-1"]') as HTMLElement;
    const header = row.querySelector('[data-testid="timeline-message-header"]') as HTMLElement;

    row.getBoundingClientRect = () =>
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
    Object.defineProperty(list, 'scrollTop', { value: 100, writable: true, configurable: true });
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;

    fireEvent.click(header);

    expect(scrollTo).toHaveBeenCalledWith({ top: 320 - 0 + 100, behavior: 'smooth' });
  });
});
