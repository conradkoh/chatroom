import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AllTabMessageList } from './AllTabMessageList';
import { getTimelineVirtualRowZIndex } from '../../components/timeline/timelineRowStyles';

vi.mock('../../components/timeline/TimelineEventRow', () => ({
  TimelineEventRow: ({ event }: { event: { id: string } }) => (
    <div data-testid={`event-row-${event.id}`}>{event.id}</div>
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

function scrollToBottom(el: HTMLElement) {
  Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: 1200, configurable: true });
  Object.defineProperty(el, 'scrollTop', { value: 1000, writable: true, configurable: true });
  fireEvent.scroll(el);
}

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
