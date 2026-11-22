import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TimelineUserMessage } from './TimelineUserMessage';
import type { Message } from '../../types/message';

vi.mock('../../features/scheduled-prompts/components/ScheduledPromptDetailDialog', () => ({
  ScheduledPromptDetailDialog: () => <div>DetailDialog</div>,
}));

vi.mock('./TimelineMarkdownBody', () => ({
  TimelineMarkdownBody: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('./TimelineMessageFooter', () => ({
  TimelineMessageFooter: () => <div>Footer</div>,
}));

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    _id: 'msg-1',
    type: 'message',
    senderRole: 'user',
    content: 'hello',
    _creationTime: 1000,
    ...overrides,
  };
}

const STATUS_LABELS = ['pending', 'acknowledged', 'in progress', 'done', 'cancelled', 'backlog'];

describe('TimelineUserMessage', () => {
  it('shows scheduled badge for sourcePlatform scheduled', () => {
    render(
      <TimelineUserMessage
        message={createMessage({ sourcePlatform: 'scheduled' })}
        chatroomId="room-1"
      />
    );
    expect(screen.getByTestId('scheduled-message-badge')).toBeInTheDocument();
  });

  it('shows scheduled badge for scheduledPromptId', () => {
    render(
      <TimelineUserMessage
        message={createMessage({ scheduledPromptId: 'prompt-1' })}
        chatroomId="room-1"
      />
    );
    expect(screen.getByTestId('scheduled-message-badge')).toBeInTheDocument();
  });

  it('shows telegram badge for telegram messages', () => {
    render(
      <TimelineUserMessage
        message={createMessage({ sourcePlatform: 'telegram' })}
        chatroomId="room-1"
      />
    );
    expect(screen.getByText('Telegram')).toBeInTheDocument();
  });

  it('renders message content', () => {
    render(<TimelineUserMessage message={createMessage()} chatroomId="room-1" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('renders "user → planner" in the default header right slot', () => {
    render(
      <TimelineUserMessage message={createMessage({ targetRole: 'planner' })} chatroomId="room-1" />
    );
    const header = screen.getByTestId('timeline-message-header');
    expect(header).toHaveTextContent('user');
    expect(header).toHaveTextContent('planner');

    const route = screen.getByTestId('timeline-message-route');
    const defaultRow = route.parentElement as HTMLElement;
    expect(defaultRow.lastElementChild).toBe(route);
  });

  it('omits arrow and target when targetRole is absent', () => {
    render(<TimelineUserMessage message={createMessage()} chatroomId="room-1" />);
    const header = screen.getByTestId('timeline-message-header');
    expect(header).toHaveTextContent('user');

    const route = screen.getByTestId('timeline-message-route');
    expect(route.textContent).toBe('user');
    expect(route.querySelector('svg')).toBeNull();
  });

  it('shows queued on the left and the route on the right for queued messages', () => {
    render(
      <TimelineUserMessage
        message={createMessage({ isQueued: true, targetRole: 'planner' })}
        chatroomId="room-1"
      />
    );
    const header = screen.getByTestId('timeline-message-header');
    expect(header).toHaveTextContent('queued');
    expect(header).toHaveTextContent('planner');

    const route = screen.getByTestId('timeline-message-route');
    const defaultRow = route.parentElement as HTMLElement;
    expect(defaultRow.lastElementChild).toBe(route);
    expect(defaultRow.firstElementChild).toHaveTextContent('queued');
  });

  it.each(['pending', 'acknowledged', 'in_progress', 'completed', 'cancelled', 'backlog'])(
    'renders no task-status label for legacy payload with taskStatus=%s',
    (status) => {
      render(
        <TimelineUserMessage
          // Legacy payloads may still carry taskStatus; the header must ignore it.
          message={{ ...createMessage(), taskStatus: status } as unknown as Message}
          chatroomId="room-1"
        />
      );
      const header = screen.getByTestId('timeline-message-header');
      for (const label of STATUS_LABELS) {
        expect(header).not.toHaveTextContent(label);
      }
    }
  );

  it('does not show message text in default header', () => {
    render(
      <TimelineUserMessage
        message={createMessage({ content: 'default header text' })}
        chatroomId="room-1"
      />
    );
    const header = screen.getByTestId('timeline-message-header');
    expect(header).not.toHaveTextContent('default header text');
    expect(screen.getByText('default header text')).toBeInTheDocument();
  });
});
