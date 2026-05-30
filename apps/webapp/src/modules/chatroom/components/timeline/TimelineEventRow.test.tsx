/**
 * TimelineEventRow — delegates to the correct cell by event.kind.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import type { Message } from '../../types/message';
import { mapMessageToTimelineEvent } from '../../timeline/mapMessageToTimelineEvent';

import { TimelineEventRow } from './TimelineEventRow';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'Hello timeline',
    _creationTime: 1_000,
    ...overrides,
  };
}

const TEST_CHATROOM_ID = 'jn7fmvz7sd76z5wwgj1m7ty6vd7z81x2';

describe('TimelineEventRow', () => {
  it('renders user message cell', () => {
    const event = mapMessageToTimelineEvent(makeMessage());
    render(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);
    expect(screen.getByTestId('timeline-user-message')).toBeInTheDocument();
    expect(screen.getByText('Hello timeline')).toBeInTheDocument();
  });

  it('renders context cell', () => {
    const event = mapMessageToTimelineEvent(
      makeMessage({ type: 'new-context', senderRole: 'system', content: 'Context body' })
    );
    render(<TimelineEventRow event={event} chatroomId={TEST_CHATROOM_ID} />);
    expect(screen.getByTestId('timeline-context')).toBeInTheDocument();
    expect(screen.getByText('New Context')).toBeInTheDocument();
  });

  it('renders team message cell with machine label when provided', () => {
    const event = mapMessageToTimelineEvent(
      makeMessage({ senderRole: 'builder', content: 'Handoff note' })
    );
    const machines = new Map([['m1', { hostname: 'dev-box', alias: 'Dev' }]]);
    render(
      <TimelineEventRow
        event={event}
        chatroomId={TEST_CHATROOM_ID}
        machines={machines}
        machineId="m1"
      />
    );
    expect(screen.getByTestId('timeline-team-message')).toBeInTheDocument();
    expect(screen.getByText('(Dev)')).toBeInTheDocument();
    expect(screen.getByText('Handoff note')).toBeInTheDocument();
  });
});
