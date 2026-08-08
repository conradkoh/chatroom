/**
 * MessageInput — drag-and-drop file attachment tests
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageInput } from './MessageInput';
import { AttachmentsProvider } from '../attachments';

const mockSendMessage = vi.fn().mockResolvedValue('msg-id');
const mockStartUpload = vi.fn();
const mockToastError = vi.fn();
let uploadJobs: {
  id: string;
  phase: string;
  percent: number;
  filePath: string;
  fileName: string;
}[] = [];

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock('../hooks/useChatInputFileDrop', () => ({
  useChatInputFileDrop: (args: {
    message: string;
    setMessage: (value: string) => void;
    machineId?: string | null;
    workingDir?: string | null;
  }) => ({
    uploadJobs,
    isDragging: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: (event: React.DragEvent) => {
      if (!args.machineId || !args.workingDir) {
        mockToastError('Connect a workspace to attach files');
        return;
      }
      const files = Array.from(event.dataTransfer.files);
      if (files.length === 0) return;
      const refs = files.map((file) => `.chatroom/downloads/attachments/files/uuid_${file.name}`);
      args.setMessage(`${args.message} ${refs.join(' ')}`.trim());
      files.forEach((file, index) => {
        mockStartUpload(refs[index], file, { uploadKind: 'chatAttachment' });
      });
    },
  }),
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
    uploadJobs = [];
    mockSendMessage.mockClear();
    mockStartUpload.mockClear();
    mockToastError.mockClear();
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

    expect(mockStartUpload).toHaveBeenCalledTimes(2);
    expect(mockStartUpload.mock.calls[0]?.[2]).toEqual({ uploadKind: 'chatAttachment' });
    expect((textarea as HTMLTextAreaElement).value).toContain('uuid_a.txt');
    expect((textarea as HTMLTextAreaElement).value).toContain('uuid_b.txt');
  });

  it('blocks send while uploads are active', () => {
    uploadJobs = [
      {
        id: 'job-1',
        phase: 'uploading',
        percent: 10,
        filePath: 'path/a.txt',
        fileName: 'a.txt',
      },
    ];

    renderComposer({
      machineId: 'machine-1',
      workingDir: '/workspace',
    });

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'ready to send' } });

    const sendButton = screen.getByRole('button', { name: 'Send message' });
    expect(sendButton).toBeDisabled();

    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('shows toast when dropping without a workspace', () => {
    renderComposer();

    const container = document.querySelector('[data-main-chat-composer]');
    fireEvent.drop(container!, makeDropEvent([makeFile('a.txt')]));

    expect(mockToastError).toHaveBeenCalledWith('Connect a workspace to attach files');
  });
});
