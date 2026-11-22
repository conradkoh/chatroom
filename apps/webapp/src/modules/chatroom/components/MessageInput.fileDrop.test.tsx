/**
 * MessageInput — drag-and-drop file attachment tests
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageInput } from './MessageInput';
import { AttachmentsProvider } from '../attachments';

const mockSendMessage = vi.fn().mockResolvedValue('msg-id');
const mockUploadFile = vi.fn();

vi.mock('../workspace/hooks/useWorkspaceFileUpload', () => ({
  useWorkspaceFileUpload: () => ({ uploadFile: mockUploadFile }),
}));

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

function makeFile(name: string): File {
  return new File(['content'], name, { type: 'text/plain' });
}

function renderComposer(props?: Partial<React.ComponentProps<typeof MessageInput>>) {
  return render(
    <AttachmentsProvider>
      <MessageInput chatroomId="chatroom-1" {...props} />
    </AttachmentsProvider>
  );
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

describe('MessageInput file drop', () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
    mockUploadFile.mockReset();
    mockUploadFile.mockResolvedValue(undefined);
  });

  it('starts uploads for dropped files in order', () => {
    renderComposer({
      machineId: 'machine-1',
      workingDir: '/workspace',
    });

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'draft message' } });

    const container = document.querySelector('[data-main-chat-composer]');
    fireEvent.drop(container!, makeDropEvent([makeFile('a.txt'), makeFile('b.txt')]));

    expect(mockUploadFile).toHaveBeenCalledTimes(2);
    expect(mockUploadFile.mock.calls[0]?.[0]).toContain('a.txt');
    expect(mockUploadFile.mock.calls[0]?.[3]).toEqual({ uploadKind: 'chatAttachment' });
    expect((textarea as HTMLTextAreaElement).value).toContain('a.txt');
    expect((textarea as HTMLTextAreaElement).value).toContain('b.txt');
  });

  it('blocks send while uploads are active', () => {
    mockUploadFile.mockReturnValue(new Promise(() => {}));
    renderComposer({
      machineId: 'machine-1',
      workingDir: '/workspace',
    });

    const container = document.querySelector('[data-main-chat-composer]');
    fireEvent.drop(container!, makeDropEvent([makeFile('a.txt')]));

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'ready to send' } });

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(sendButton).toBeDisabled();

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('shows the no-workspace message inline when dropping without a workspace', () => {
    renderComposer();
    const container = document.querySelector('[data-main-chat-composer]');
    fireEvent.drop(container!, makeDropEvent([makeFile('a.txt')]));
    expect(screen.getByRole('alert')).toHaveTextContent('Connect a workspace to attach files');
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('dismisses the no-workspace message from its close button', () => {
    renderComposer();
    const container = document.querySelector('[data-main-chat-composer]');
    fireEvent.drop(container!, makeDropEvent([makeFile('a.txt')]));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss attach error' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a failed upload inline and lets the user dismiss it', async () => {
    mockUploadFile.mockRejectedValueOnce(new Error('Disk full'));
    renderComposer({ machineId: 'machine-1', workingDir: '/workspace' });
    const container = document.querySelector('[data-main-chat-composer]');
    fireEvent.drop(container!, makeDropEvent([makeFile('a.txt')]));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
