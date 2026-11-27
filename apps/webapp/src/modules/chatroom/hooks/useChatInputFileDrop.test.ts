import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useChatInputFileDrop } from './useChatInputFileDrop';

const mockStartUpload = vi.fn();
const mockDismissJob = vi.fn();

vi.mock('../workspace/hooks/useWorkspaceUploadJobs', () => ({
  useWorkspaceUploadJobs: () => ({
    jobs: [],
    startUpload: mockStartUpload,
    dismissJob: mockDismissJob,
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

function makeChangeEvent(files: File[]): React.ChangeEvent<HTMLInputElement> {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', { value: files });
  return { target: input } as unknown as React.ChangeEvent<HTMLInputElement>;
}

function makePasteEvent(files: File[]): React.ClipboardEvent<HTMLTextAreaElement> {
  const items = files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file }));
  return {
    preventDefault: vi.fn(),
    clipboardData: { items },
  } as unknown as React.ClipboardEvent<HTMLTextAreaElement>;
}

function makeFilesOnlyPasteEvent(files: File[]): React.ClipboardEvent<HTMLTextAreaElement> {
  return {
    preventDefault: vi.fn(),
    clipboardData: { items: [], files },
  } as unknown as React.ClipboardEvent<HTMLTextAreaElement>;
}

function makeTextPasteEvent(_text: string): React.ClipboardEvent<HTMLTextAreaElement> {
  const items = [{ kind: 'string', type: 'text/plain', getAsFile: () => null }];
  return {
    preventDefault: vi.fn(),
    clipboardData: { items, files: [] },
  } as unknown as React.ClipboardEvent<HTMLTextAreaElement>;
}

describe('useChatInputFileDrop', () => {
  beforeEach(() => {
    mockStartUpload.mockReset();
    mockDismissJob.mockReset();
    vi.stubGlobal('crypto', { randomUUID: () => 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' });
  });

  it('exposes attachFiles with upload path and reference insertion', () => {
    const setMessage = vi.fn();
    const textareaRef = { current: { selectionStart: 0 } as HTMLTextAreaElement };
    const { result } = renderHook(() =>
      useChatInputFileDrop({
        machineId: 'machine-1',
        workingDir: '/workspace',
        message: '',
        setMessage,
        textareaRef,
      })
    );
    act(() =>
      result.current.attachFiles([
        new File(['png'], 'sketch-20260816-120000.png', { type: 'image/png' }),
      ])
    );
    expect(setMessage).toHaveBeenCalledWith(expect.stringContaining('sketch-20260816-120000.png'));
    expect(mockStartUpload).toHaveBeenCalledWith(
      expect.stringContaining('.chatroom/downloads/attachments/files/'),
      expect.any(File),
      { uploadKind: 'chatAttachment' }
    );
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

  it('attaches files from file input change preserving order', () => {
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
      result.current.handleFileInputChange(makeChangeEvent([makeFile('a.txt'), makeFile('b.txt')]));
    });

    expect(setMessage).toHaveBeenCalledTimes(1);
    const inserted = setMessage.mock.calls[0]?.[0] as string;
    expect(inserted).toContain(
      '.chatroom/downloads/attachments/files/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d_a.txt'
    );
    expect(inserted.indexOf('a.txt')).toBeLessThan(inserted.indexOf('b.txt'));
    expect(mockStartUpload).toHaveBeenCalledTimes(2);
  });

  it('sets the no-workspace message when picking files without a workspace', () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() =>
      useChatInputFileDrop({ message: 'hey', setMessage, textareaRef: { current: null } })
    );
    act(() => {
      result.current.handleFileInputChange(makeChangeEvent([makeFile('a.txt')]));
    });
    expect(result.current.attachError).toBe('Connect a workspace to attach files');
    expect(setMessage).not.toHaveBeenCalled();
    expect(mockStartUpload).not.toHaveBeenCalled();
  });

  it('inserts pasted image path at caret and starts upload', () => {
    const setMessage = vi.fn();
    const textareaRef = { current: { selectionStart: 3 } as HTMLTextAreaElement };
    const { result } = renderHook(() =>
      useChatInputFileDrop({
        machineId: 'm',
        workingDir: '/w',
        message: 'hey',
        setMessage,
        textareaRef,
      })
    );
    const event = makePasteEvent([new File(['x'], 'blob', { type: 'image/png' })]);
    act(() => result.current.handlePaste(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(setMessage.mock.calls[0]?.[0]).toContain('pasted-image.png');
    expect(mockStartUpload).toHaveBeenCalledTimes(1);
  });

  it('attaches a files-only paste at the caret and prevents default', () => {
    const setMessage = vi.fn();
    const textareaRef = { current: { selectionStart: 7 } as HTMLTextAreaElement };
    const { result } = renderHook(() =>
      useChatInputFileDrop({
        machineId: 'm',
        workingDir: '/w',
        message: 'before after',
        setMessage,
        textareaRef,
      })
    );
    const event = makeFilesOnlyPasteEvent([new File(['x'], 'blob', { type: 'image/png' })]);
    act(() => result.current.handlePaste(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(setMessage.mock.calls[0]?.[0]).toMatch(/^before .+pasted-image\.png after$/);
    expect(mockStartUpload).toHaveBeenCalledWith(
      expect.stringContaining('pasted-image.png'),
      expect.any(File),
      { uploadKind: 'chatAttachment' }
    );
  });

  it('attaches a pasted non-image file by its real name', () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() =>
      useChatInputFileDrop({
        machineId: 'm',
        workingDir: '/w',
        message: '',
        setMessage,
        textareaRef: { current: null },
      })
    );
    const event = makeFilesOnlyPasteEvent([
      new File(['%PDF'], 'report.pdf', { type: 'application/pdf' }),
    ]);
    act(() => result.current.handlePaste(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(setMessage.mock.calls[0]?.[0]).toContain('report.pdf');
    expect(mockStartUpload).toHaveBeenCalledTimes(1);
  });

  it('uploads a file present in both items and files once', () => {
    const image = new File(['x'], 'blob', { type: 'image/png' });
    const { result } = renderHook(() =>
      useChatInputFileDrop({
        machineId: 'm',
        workingDir: '/w',
        message: '',
        setMessage: vi.fn(),
        textareaRef: { current: null },
      })
    );
    const event = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => image }],
        files: [image],
      },
    } as unknown as React.ClipboardEvent<HTMLTextAreaElement>;
    act(() => result.current.handlePaste(event));
    expect(mockStartUpload).toHaveBeenCalledTimes(1);
  });

  it('leaves a text-only paste untouched', () => {
    const setMessage = vi.fn();
    const { result } = renderHook(() =>
      useChatInputFileDrop({ message: 'hey', setMessage, textareaRef: { current: null } })
    );
    const event = makeTextPasteEvent('hello');
    act(() => result.current.handlePaste(event));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(setMessage).not.toHaveBeenCalled();
    expect(mockStartUpload).not.toHaveBeenCalled();
  });

  it('sets the no-workspace message when pasting image without workspace', () => {
    const event = makePasteEvent([new File(['x'], 'blob', { type: 'image/png' })]);
    const { result } = renderHook(() =>
      useChatInputFileDrop({ message: 'hey', setMessage: vi.fn(), textareaRef: { current: null } })
    );
    act(() => result.current.handlePaste(event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.attachError).toBe('Connect a workspace to attach files');
  });

  it('clears the no-workspace message once a workspace is connected and files attach', () => {
    const { result, rerender } = renderHook(
      ({ machineId }: { machineId: string | null }) =>
        useChatInputFileDrop({
          machineId,
          workingDir: '/workspace',
          message: 'hey',
          setMessage: vi.fn(),
          textareaRef: { current: null },
        }),
      { initialProps: { machineId: null as string | null } }
    );
    act(() => result.current.attachFiles([makeFile('a.txt')]));
    expect(result.current.attachError).toBe('Connect a workspace to attach files');

    rerender({ machineId: 'machine-1' });
    act(() => result.current.attachFiles([makeFile('a.txt')]));
    expect(result.current.attachError).toBeNull();
  });

  it('dismissAttachError clears the no-workspace message', () => {
    const { result } = renderHook(() =>
      useChatInputFileDrop({ message: 'hey', setMessage: vi.fn(), textareaRef: { current: null } })
    );
    act(() => result.current.attachFiles([makeFile('a.txt')]));
    expect(result.current.attachError).toBe('Connect a workspace to attach files');
    act(() => result.current.dismissAttachError());
    expect(result.current.attachError).toBeNull();
  });

  it('exposes dismissUploadJob from the upload jobs hook', () => {
    const { result } = renderHook(() =>
      useChatInputFileDrop({
        machineId: 'machine-1',
        workingDir: '/workspace',
        message: '',
        setMessage: vi.fn(),
        textareaRef: { current: null },
      })
    );
    expect(result.current.dismissUploadJob).toBe(mockDismissJob);
    act(() => result.current.dismissUploadJob('job-1'));
    expect(mockDismissJob).toHaveBeenCalledWith('job-1');
  });
});
