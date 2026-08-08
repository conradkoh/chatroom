import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatInputFileDrop } from './useChatInputFileDrop';

const mockStartUpload = vi.fn();
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock('../workspace/hooks/useWorkspaceUploadJobs', () => ({
  useWorkspaceUploadJobs: () => ({
    jobs: [],
    startUpload: mockStartUpload,
  }),
}));

vi.mock('@workspace/backend/src/domain/constants/chat-attachment-upload-path', () => ({
  buildChatAttachmentUploadPath: (name: string, id: string) =>
    `.chatroom/downloads/attachments/files/${id}_${name}`,
}));

function makeFile(name: string): File {
  return new File(['content'], name, { type: 'text/plain' });
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

describe('useChatInputFileDrop', () => {
  beforeEach(() => {
    mockStartUpload.mockReset();
    mockToastError.mockReset();
    vi.stubGlobal('crypto', { randomUUID: () => 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' });
  });

  it('inserts multiple paths in one setMessage call preserving order', () => {
    const setMessage = vi.fn();
    const textareaRef = { current: { selectionStart: 3 } as HTMLTextAreaElement };

    const { result } = renderHook(() =>
      useChatInputFileDrop({
        machineId: 'machine-1',
        workingDir: '/workspace',
        message: 'hey',
        setMessage,
        textareaRef,
      })
    );

    act(() => {
      result.current.handleDrop(makeDropEvent([makeFile('a.txt'), makeFile('b.txt')]));
    });

    expect(setMessage).toHaveBeenCalledTimes(1);
    const inserted = setMessage.mock.calls[0]?.[0] as string;
    expect(inserted).toContain(
      '.chatroom/downloads/attachments/files/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d_a.txt'
    );
    expect(inserted.indexOf('a.txt')).toBeLessThan(inserted.indexOf('b.txt'));
    expect(mockStartUpload).toHaveBeenCalledTimes(2);
  });

  it('inserts at the caret without overwriting surrounding text', () => {
    const setMessage = vi.fn();
    const textareaRef = { current: { selectionStart: 7 } as HTMLTextAreaElement };

    const { result } = renderHook(() =>
      useChatInputFileDrop({
        machineId: 'machine-1',
        workingDir: '/workspace',
        message: 'before after',
        setMessage,
        textareaRef,
      })
    );

    act(() => {
      result.current.handleDrop(makeDropEvent([makeFile('a.txt')]));
    });

    const inserted = setMessage.mock.calls[0]?.[0] as string;
    expect(inserted).toMatch(/^before .+\.txt after$/);
  });
});
