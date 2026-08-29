/**
 * MessageInput — deferred focus after Cmd+K chatroom navigation
 */

import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentsProvider } from '../attachments';
import {
  requestComposerFocusAfterNavigation,
  resetPendingComposerFocusForTests,
} from '../utils/pendingComposerFocus';
import { MessageInput } from './MessageInput';

const mockSendMessage = vi.fn().mockResolvedValue('msg-id');

beforeAll(() => {
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
});

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockSendMessage,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { messages: { sendMessage: 'messages:sendMessage' } },
}));

vi.mock('../hooks/useTriggerAutocomplete', () => ({
  useTriggerAutocomplete: () => ({
    state: { visible: false, results: [], selectedIndex: 0, position: null },
    handleInputChange: vi.fn(),
    handleKeyDown: vi.fn(() => false),
    handleSelect: vi.fn(),
    setSelectedIndex: vi.fn(),
  }),
}));

vi.mock('./FileReferenceAutocomplete', () => ({
  FileReferenceAutocomplete: () => null,
}));

vi.mock('../hooks/useChatInputFileDrop', () => ({
  useChatInputFileDrop: () => ({
    uploadJobs: [],
    isDragging: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
  }),
}));

function renderMessageInput(chatroomId: string) {
  return render(
    <AttachmentsProvider>
      <MessageInput chatroomId={chatroomId} />
    </AttachmentsProvider>
  );
}

describe('MessageInput pending composer focus', () => {
  beforeEach(() => {
    resetPendingComposerFocusForTests();
    mockSendMessage.mockClear();
    localStorage.clear();
  });

  it('focuses textarea on remount when pending flag was set before navigation', () => {
    const { unmount } = renderMessageInput('room-a');
    requestComposerFocusAfterNavigation();
    unmount();

    renderMessageInput('room-b');

    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('does not focus on mount when pending flag was not set', () => {
    renderMessageInput('room-a');
    expect(screen.getByRole('textbox')).not.toHaveFocus();
  });
});
