import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewFileDialog } from './NewFileDialog';
import { normalizeNewFilePath, validateRelativeFilePath } from '../utils/gzipContent';

const mockRequestFileWrite = vi.fn();
const mockWaitForFileWriteRequest = vi.fn();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-new-file'],
  useSessionMutation: () => mockRequestFileWrite,
}));

vi.mock('convex/react', () => ({
  useConvex: () => ({ query: vi.fn() }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      requestFileWrite: 'requestFileWrite',
      getFileWriteRequest: 'getFileWriteRequest',
    },
  },
}));

vi.mock('../hooks/fileWritePolling', () => ({
  waitForFileWriteRequest: (...args: unknown[]) => mockWaitForFileWriteRequest(...args),
}));

vi.mock('../utils/gzipContent', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    compressGzip: vi.fn().mockResolvedValue({ compression: 'gzip', content: 'dGVzdA==' }),
  };
});

describe('validateRelativeFilePath', () => {
  it('rejects path traversal', () => {
    expect(validateRelativeFilePath('../etc/passwd')).toBe('Path traversal is not allowed');
  });

  it('rejects absolute paths', () => {
    expect(validateRelativeFilePath('/etc/passwd')).toBe('Absolute paths are not allowed');
  });

  it('accepts safe relative paths', () => {
    expect(validateRelativeFilePath('docs/notes.md')).toBeNull();
  });
});

describe('normalizeNewFilePath', () => {
  it('appends .md when no extension is provided', () => {
    expect(normalizeNewFilePath('notes')).toBe('notes.md');
  });

  it('preserves explicit markdown extension', () => {
    expect(normalizeNewFilePath('docs/guide.md')).toBe('docs/guide.md');
  });
});

describe('NewFileDialog', () => {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestFileWrite.mockResolvedValue({ requestId: 'req-create-1' });
    mockWaitForFileWriteRequest.mockResolvedValue(undefined);
  });

  it('creates a file when Cmd+S is pressed in the path input', async () => {
    render(
      <NewFileDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        onCreated={onCreated}
      />
    );

    const input = screen.getByPlaceholderText('docs/notes.md');
    fireEvent.change(input, { target: { value: 'notes.md' } });
    fireEvent.keyDown(input, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(mockRequestFileWrite).toHaveBeenCalledWith(
        expect.objectContaining({
          machineId: 'machine-1',
          workingDir: '/workspace',
          filePath: 'notes.md',
          operation: 'create',
        })
      );
    });

    expect(mockWaitForFileWriteRequest).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith('notes.md');
  });
});
