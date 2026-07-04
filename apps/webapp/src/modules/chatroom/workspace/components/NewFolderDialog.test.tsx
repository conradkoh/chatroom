import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewFolderDialog } from './NewFolderDialog';

const mockRequestMkdir = vi.fn();
const mockConfirmMkdir = vi.fn();

vi.mock('../hooks/useWorkspaceFileMkdir', () => ({
  useWorkspaceFileMkdir: () => ({
    requestMkdir: mockRequestMkdir,
    confirmMkdir: mockConfirmMkdir,
  }),
}));

describe('NewFolderDialog', () => {
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();
  const onCreateFailed = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestMkdir.mockResolvedValue({ requestId: 'req-mkdir-1' });
    mockConfirmMkdir.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
  });

  it('focuses the path input when the dialog opens', () => {
    render(
      <NewFolderDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        onCreated={onCreated}
      />
    );

    const input = screen.getByPlaceholderText('docs');
    expect(document.activeElement).toBe(input);
  });

  it('creates a nested folder path from defaultDir and folder name', () => {
    render(
      <NewFolderDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        defaultDir="src"
        onCreated={onCreated}
      />
    );

    const input = screen.getByLabelText('Folder name in src');
    fireEvent.change(input, { target: { value: 'components' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreated).toHaveBeenCalledWith('src/components');
    expect(mockRequestMkdir).toHaveBeenCalledWith('src/components');
  });

  it('creates a root folder path from full path input', () => {
    render(
      <NewFolderDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        onCreated={onCreated}
      />
    );

    const input = screen.getByPlaceholderText('docs');
    fireEvent.change(input, { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onCreated).toHaveBeenCalledWith('docs');
    expect(mockRequestMkdir).toHaveBeenCalledWith('docs');
  });

  it('rejects slashes in nested folder name input', () => {
    render(
      <NewFolderDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        defaultDir="src"
        onCreated={onCreated}
      />
    );

    const input = screen.getByLabelText('Folder name in src');
    fireEvent.change(input, { target: { value: 'nested/components' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Enter a name only')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('calls onCreated immediately before background mkdir resolves', async () => {
    render(
      <NewFolderDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        onCreated={onCreated}
      />
    );

    const input = screen.getByPlaceholderText('docs');
    fireEvent.change(input, { target: { value: 'docs' } });
    fireEvent.keyDown(input, { key: 's', metaKey: true });

    expect(onCreated).toHaveBeenCalledWith('docs');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockRequestMkdir).toHaveBeenCalledWith('docs');

    await waitFor(() => {
      expect(mockConfirmMkdir).toHaveBeenCalledWith('req-mkdir-1');
    });
  });

  it('calls onCreateFailed when background mkdir rejects', async () => {
    mockConfirmMkdir.mockRejectedValue(new Error('Directory already exists'));

    render(
      <NewFolderDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        onCreated={onCreated}
        onCreateFailed={onCreateFailed}
      />
    );

    const input = screen.getByPlaceholderText('docs');
    fireEvent.change(input, { target: { value: 'docs' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(onCreateFailed).toHaveBeenCalledWith('docs', 'Directory already exists');
    });
  });
});
