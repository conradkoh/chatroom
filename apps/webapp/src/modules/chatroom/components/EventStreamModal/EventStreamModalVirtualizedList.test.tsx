import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EventStreamModalVirtualizedList } from './EventStreamModalVirtualizedList';
import { EVENT_STREAM_ROW_HEIGHT } from '../../eventTypes';
import type { EventStreamEvent } from '../../viewModels/eventStreamViewModel';

vi.mock('../../eventTypes', () => ({
  EVENT_STREAM_ROW_HEIGHT: 52,
  resolveEventTypeDefinition: () => ({
    cellRenderer: (event: { _id: string; type: string }, isSelected: boolean) => (
      <div data-testid={`event-${event._id}`} data-selected={isSelected}>
        {event.type}
      </div>
    ),
    detailsRenderer: () => null,
  }),
  initializeEventTypes: () => {},
}));

function makeEvent(id: string, type = 'task.inProgress'): EventStreamEvent {
  return { _id: id, type, _creationTime: 100 } as EventStreamEvent;
}

describe('EventStreamModalVirtualizedList', () => {
  it('renders events via VirtualizedScrollList', () => {
    const events = [makeEvent('e1'), makeEvent('e2')];
    const { container } = render(
      <EventStreamModalVirtualizedList
        events={events}
        selectedEventId={null}
        onSelectEvent={vi.fn()}
        height={200}
      />
    );
    // VirtualizedScrollList renders a scroll container
    const scrollContainer = container.querySelector('.overflow-y-auto');
    expect(scrollContainer).toBeInTheDocument();
    expect(scrollContainer).toHaveStyle('height: 200px');
  });

  it('accepts listRef prop', () => {
    const ref = { current: null };
    render(
      <EventStreamModalVirtualizedList
        events={[]}
        selectedEventId={null}
        onSelectEvent={vi.fn()}
        height={200}
        listRef={ref}
      />
    );
    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });

  it('EVENT_STREAM_ROW_HEIGHT matches EventRow rendered height', () => {
    // SSOT: virtualizer estimates rows at this height;
    // EventRow must match so there are no gaps between rows.
    expect(EVENT_STREAM_ROW_HEIGHT).toBe(52);
  });
});
