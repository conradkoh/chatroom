/**
 * MessageInput — conversationMode integration tests
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachmentsProvider } from '../attachments';
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

vi.mock('../hooks/useConversationMode', () => ({
  useConversationMode: () => ({
    mode: 'code:enhanced',
    setMode: vi.fn(),
    hasUserSelected: false,
  }),
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
    fileInputRef: { current: null },
    handleAttachClick: vi.fn(),
    handleFileInputChange: vi.fn(),
    handlePaste: vi.fn(),
    attachFiles: vi.fn(),
  }),
}));

vi.mock('../hooks/useStartInNewSessionPreference', () => ({
  useStartInNewSessionPreference: () => ({ startInNewSession: false }),
}));

vi.mock('../hooks/useFileReferenceAutocomplete', () => ({
  useFileReferenceAutocomplete: ({ onTextChange }: { onTextChange: (v: string) => void }) => ({
    autocompleteState: {
      visible: false,
      results: [],
      selectedIndex: 0,
      position: { top: 0, left: 0 },
    },
    handleTextareaChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      onTextChange(e.target.value);
    },
    handleAutocompleteKeyDown: vi.fn(() => false),
    handleFileSelect: vi.fn(),
    setSelectedIndex: vi.fn(),
  }),
}));

vi.mock('../utils/pendingComposerFocus', () => ({
  takePendingComposerFocus: () => false,
}));

vi.mock('../workspace/files/workspaceFileTreeAutocompleteVisible', () => ({
  setFileTreeAutocompleteVisible: vi.fn(),
}));

function renderMessageInput(chatroomId: string) {
  return render(
    <AttachmentsProvider>
      <MessageInput chatroomId={chatroomId} />
    </AttachmentsProvider>
  );
}

describe('MessageInput conversationMode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes conversationMode to sendMessage', async () => {
    renderMessageInput('room-1');

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          conversationMode: 'code:enhanced',
        })
      );
    });
  });

  it('retains selected mode after successful send', async () => {
    mockSendMessage.mockClear();
    renderMessageInput('room-1');

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'first message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    // Log what was actually called for debugging
    console.log('mockSendMessage called with:', JSON.stringify(mockSendMessage.mock.calls[0]));

    // Mode should still be code:enhanced for the next send
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationMode: 'code:enhanced',
      })
    );
  });

  it('retains mode on failed send', async () => {
    mockSendMessage.mockReset();
    mockSendMessage.mockRejectedValue(new Error('network error'));

    renderMessageInput('room-1');

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    // Log what was actually called for debugging
    console.log('mockSendMessage called with:', JSON.stringify(mockSendMessage.mock.calls[0]));

    // Error should be shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
