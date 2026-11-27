/**
 * MessageInput — Enter-to-send on touch (coarse-pointer) and non-touch devices.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageInput } from './MessageInput';
import { AttachmentsProvider } from '../attachments';

const mockSendMessage = vi.fn().mockResolvedValue('msg-id');
const mockUploadFile = vi.fn();

vi.mock('../workspace/hooks/useWorkspaceFileUpload', () => ({
  useWorkspaceFileUpload: () => ({ uploadFile: mockUploadFile }),
}));

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

/**
 * Makes `(pointer: coarse)` match only for touch. Must run before render because
 * useIsTouchDevice reads matchMedia once at mount.
 */
function stubPointer(kind: 'coarse' | 'fine') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: kind === 'coarse' && query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderComposer(props?: Partial<React.ComponentProps<typeof MessageInput>>) {
  render(
    <AttachmentsProvider>
      <MessageInput chatroomId="chatroom-1" {...props} />
    </AttachmentsProvider>
  );
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: 'hello' } });
  return textarea;
}

function makeDropEvent(files: File[]): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      types: ['Files'],
      files,
      dropEffect: 'copy',
    },
  } as unknown as React.DragEvent;
}

/** Lets any pending async send settle before asserting that nothing was sent. */
const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  mockSendMessage.mockClear();
  mockUploadFile.mockReset();
  mockUploadFile.mockResolvedValue(undefined);
});

describe('MessageInput Enter on touch devices (coarse pointer)', () => {
  beforeEach(() => stubPointer('coarse'));

  it('Cmd+Enter sends once and cancels the newline', async () => {
    const textarea = renderComposer();
    const notCancelled = fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
    expect(notCancelled).toBe(false);
  });

  it('Ctrl+Enter sends once and cancels the newline', async () => {
    const textarea = renderComposer();
    const notCancelled = fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
    expect(notCancelled).toBe(false);
  });

  it('plain Enter does not send and keeps the newline', async () => {
    const textarea = renderComposer();
    const notCancelled = fireEvent.keyDown(textarea, { key: 'Enter' });
    await flushAsync();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(notCancelled).toBe(true);
  });

  it('Shift+Enter does not send and keeps the newline', async () => {
    const textarea = renderComposer();
    const notCancelled = fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    await flushAsync();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(notCancelled).toBe(true);
  });

  it('Cmd+Shift+Enter does not send and keeps the newline', async () => {
    const textarea = renderComposer();
    const notCancelled = fireEvent.keyDown(textarea, {
      key: 'Enter',
      metaKey: true,
      shiftKey: true,
    });
    await flushAsync();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(notCancelled).toBe(true);
  });

  it('Cmd+Enter does not send while an upload is active', async () => {
    mockUploadFile.mockReturnValue(new Promise(() => {}));
    renderComposer({ machineId: 'machine-1', workingDir: '/workspace' });

    const container = document.querySelector('[data-main-chat-composer]');
    fireEvent.drop(
      container!,
      makeDropEvent([new File(['content'], 'a.txt', { type: 'text/plain' })])
    );

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'ready to send' } });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    await flushAsync();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('MessageInput Enter on non-touch devices (fine pointer)', () => {
  beforeEach(() => stubPointer('fine'));

  it('plain Enter sends once and cancels the newline', async () => {
    const textarea = renderComposer();
    const notCancelled = fireEvent.keyDown(textarea, { key: 'Enter' });
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
    expect(notCancelled).toBe(false);
  });

  it('Cmd+Enter sends once', async () => {
    const textarea = renderComposer();
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledTimes(1));
  });

  it('Shift+Enter does not send and keeps the newline', async () => {
    const textarea = renderComposer();
    const notCancelled = fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    await flushAsync();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(notCancelled).toBe(true);
  });
});
