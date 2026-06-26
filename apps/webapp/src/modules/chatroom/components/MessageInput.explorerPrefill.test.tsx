/**
 * MessageInput — explorer Cmd+I prefill integration tests
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageInput } from './MessageInput';
import {
  AttachmentsProvider,
  dispatchComposerPrefill,
  subscribeComposerPrefill,
} from '../attachments';

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

function renderMessageInput() {
  return render(
    <AttachmentsProvider>
      <MessageInput chatroomId="chatroom-1" />
    </AttachmentsProvider>
  );
}

describe('MessageInput explorer prefill', () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
    localStorage.clear();
  });

  it('adds snippet chip and inline reference on Cmd+I prefill', async () => {
    renderMessageInput();

    dispatchComposerPrefill({
      target: 'messages',
      fileSource: 'src/foo.ts',
      selectedContent: 'const x = 1;',
    });

    expect(await screen.findByText('foo.ts')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    expect(textarea.value).toBe('[attachment: attachment-reference-001]');
  });

  it('sends plain content and attachedSnippets without XML', async () => {
    renderMessageInput();

    dispatchComposerPrefill({
      target: 'messages',
      fileSource: 'src/foo.ts',
      selectedContent: 'const x = 1;',
    });

    await screen.findByText('foo.ts');

    const textarea = screen.getByPlaceholderText('Type a message...');
    fireEvent.change(textarea, {
      target: {
        value: 'What is [attachment: attachment-reference-001]?',
      },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    const payload = mockSendMessage.mock.calls[0]?.[0];
    expect(payload.content).toBe('What is [attachment: attachment-reference-001]?');
    expect(payload.content).not.toContain('<attachments>');
    expect(payload.attachedSnippets).toEqual([
      {
        reference: 'attachment-reference-001',
        fileSource: 'src/foo.ts',
        selectedContent: 'const x = 1;',
      },
    ]);
  });

  it('subscribeComposerPrefill receives dashboard dispatch', () => {
    const handler = vi.fn();
    const unsub = subscribeComposerPrefill(handler);

    const detail = {
      target: 'messages' as const,
      fileSource: 'b.ts',
      selectedContent: 'y',
    };
    dispatchComposerPrefill(detail);

    expect(handler).toHaveBeenCalledWith(detail);
    unsub();
  });
});
