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

  it('sends one complete TaskEnvelopeV1 instead of scalar policy fields', async () => {
    renderMessageInput('room-1');

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, { target: { value: 'test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    const args = mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
    // No independent scalar policy fields are submitted.
    expect(args).not.toHaveProperty('conversationMode');
    expect(args).not.toHaveProperty('startInNewSession');
    expect(args.taskEnvelope).toEqual({
      version: 1,
      conversationMode: 'code:enhanced',
      sessionPolicy: 'continue',
      handoffWorkflow: { preset: 'enhanced-team', phase: 'entry' },
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

    // Mode should still be code:enhanced for the next send
    const currentFirst = mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
    expect((currentFirst.taskEnvelope as { conversationMode: string }).conversationMode).toBe(
      'code:enhanced'
    );

    fireEvent.change(textarea, { target: { value: 'second message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });
    const currentSecond = mockSendMessage.mock.calls[1][0] as Record<string, unknown>;
    expect((currentSecond.taskEnvelope as { conversationMode: string }).conversationMode).toBe(
      'code:enhanced'
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

    // Error should be shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    // The failed-send call still carried the correct complete envelope.
    const args = mockSendMessage.mock.calls[0][0] as Record<string, unknown>;
    expect((args.taskEnvelope as { conversationMode: string }).conversationMode).toBe(
      'code:enhanced'
    );
  });
});
