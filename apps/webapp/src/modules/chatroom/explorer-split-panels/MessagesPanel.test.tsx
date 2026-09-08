import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessagesPanel } from './MessagesPanel';

const { mockChatroomMessagesPanel } = vi.hoisted(() => ({
  mockChatroomMessagesPanel: vi.fn(),
}));

vi.mock('../components/MessageInput', () => ({
  MessageInput: () => <div data-testid="message-input" />,
}));

vi.mock('../components/timeline/ChatroomMessagesPanel', () => ({
  ChatroomMessagesPanel: (props: unknown) => {
    mockChatroomMessagesPanel(props);
    return <div data-testid="chatroom-messages-panel" />;
  },
}));

describe('MessagesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards onRequestComposerFocus to ChatroomMessagesPanel', () => {
    const onRequestComposerFocus = vi.fn();
    render(<MessagesPanel chatroomId="room-1" onRequestComposerFocus={onRequestComposerFocus} />);

    expect(mockChatroomMessagesPanel).toHaveBeenCalledWith(
      expect.objectContaining({ onRequestComposerFocus })
    );
  });
});
