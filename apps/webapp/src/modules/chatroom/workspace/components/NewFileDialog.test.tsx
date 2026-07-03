import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewFileDialog } from './NewFileDialog';
import { normalizeNewFilePath, validateRelativeFilePath } from '../utils/gzipContent';

const mockCreateFile = vi.fn();

vi.mock('../hooks/useWorkspaceFileCreate', () => ({
  useWorkspaceFileCreate: () => ({
    createFile: mockCreateFile,
    creating: false,
  }),
}));

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
  const onCreateFailed = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateFile.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
  });

  it('calls onCreated immediately before background create resolves', async () => {
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

    expect(onCreated).toHaveBeenCalledWith('notes.md');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockCreateFile).toHaveBeenCalledWith('notes.md', '');

    await waitFor(() => {
      expect(mockCreateFile).toHaveBeenCalledTimes(1);
    });
  });

  it('calls onCreateFailed when background create rejects', async () => {
    mockCreateFile.mockRejectedValue(new Error('File already exists'));

    render(
      <NewFileDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        onCreated={onCreated}
        onCreateFailed={onCreateFailed}
      />
    );

    const input = screen.getByPlaceholderText('docs/notes.md');
    fireEvent.change(input, { target: { value: 'notes.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onCreateFailed).toHaveBeenCalledWith('notes.md', 'File already exists');
    });
  });
});
