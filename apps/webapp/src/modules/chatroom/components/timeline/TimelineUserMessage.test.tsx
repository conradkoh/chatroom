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
    taskStatus: 'completed',
    ...overrides,
  };
}

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

  it('uses true-center grid on nav header when headerNavigation provided', () => {
    render(
      <TimelineUserMessage
        message={createMessage()}
        chatroomId="room-1"
        headerNavigation={{
          onJumpToPrevious: vi.fn(),
          onJumpToCurrent: vi.fn(),
          onJumpToNext: vi.fn(),
          hasPrevious: true,
          hasNext: true,
        }}
      />
    );
    const navRow = screen.getByTestId('timeline-message-header-nav').parentElement as HTMLElement;
    expect(navRow.className).toContain('grid-cols-[1fr_auto_1fr]');
    expect(screen.getByTestId('timeline-message-header-nav')).toBeInTheDocument();
  });

  it('does not show message text in header when headerNavigation provided', () => {
    render(
      <TimelineUserMessage
        message={createMessage({ content: 'secret header text' })}
        chatroomId="room-1"
        headerNavigation={{
          onJumpToPrevious: vi.fn(),
          onJumpToCurrent: vi.fn(),
          onJumpToNext: vi.fn(),
          hasPrevious: true,
          hasNext: true,
        }}
      />
    );
    const header = screen.getByTestId('timeline-message-header');
    expect(header).not.toHaveTextContent('secret header text');
    expect(screen.getByText('secret header text')).toBeInTheDocument(); // still in body
  });

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
