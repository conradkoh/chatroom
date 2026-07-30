import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AllTabMessageList } from './AllTabMessageList';

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

describe('AllTabMessageList', () => {
  it('scrolls to top when anchorId changes', () => {
    const events = [makeEvent('msg-1')];
    const { rerender } = render(<AllTabMessageList events={events} anchorId="anchor-1" />);

    const list = document.querySelector('[data-testid="all-tab-message-list"]') as HTMLDivElement;
    list.scrollTop = 500;

    rerender(<AllTabMessageList events={events} anchorId="anchor-2" />);

    expect(list.scrollTop).toBe(0);
  });
});
