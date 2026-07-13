/**
 * MessageInput — saved command text prefill integration tests
 */

import { render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageInput } from './MessageInput';
import { AttachmentsProvider, dispatchComposerTextPrefill } from '../attachments';

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
  api: {
    messages: {
      sendMessage: 'messages:sendMessage',
    },
  },
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

vi.mock('./EditorModal', () => ({
  EditorModal: () => null,
}));

describe('MessageInput saved command prefill', () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
    localStorage.clear();
  });

  it('prefills the textarea without sending a message', async () => {
    render(
      <AttachmentsProvider>
        <MessageInput chatroomId="chatroom-1" />
      </AttachmentsProvider>
    );

    dispatchComposerTextPrefill('Deploy to staging with smoke tests');

    const textarea = await screen.findByPlaceholderText('Type a message...');
    expect(textarea).toHaveValue('Deploy to staging with smoke tests');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
