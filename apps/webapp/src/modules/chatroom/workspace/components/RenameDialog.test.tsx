import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RenameDialog } from './RenameDialog';

const mockRequestRename = vi.fn();
const mockConfirmRename = vi.fn();

vi.mock('../hooks/useWorkspaceFileRename', () => ({
  useWorkspaceFileRename: () => ({
    requestRename: mockRequestRename,
    confirmRename: mockConfirmRename,
  }),
}));

describe('RenameDialog', () => {
  const onOpenChange = vi.fn();
  const onRenamed = vi.fn();
  const onRenameFailed = vi.fn();
  const onRenameConfirmed = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestRename.mockResolvedValue({ requestId: 'req-rename-1' });
    mockConfirmRename.mockResolvedValue(undefined);
  });

  it('focuses the path input when the dialog opens for a nested file', () => {
    render(
      <RenameDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        targetPath="src/old.ts"
        targetType="file"
        onRenamed={onRenamed}
      />
    );

    const input = screen.getByLabelText('New name in src');
    expect(document.activeElement).toBe(input);
  });

  it('focuses the filename input when opened for a root file', () => {
    render(
      <RenameDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        targetPath="package.json"
        targetType="file"
        onRenamed={onRenamed}
      />
    );

    const input = screen.getByLabelText('New file name');
    expect(document.activeElement).toBe(input);
  });

  it('computes correct new path for nested file rename', () => {
    render(
      <RenameDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        targetPath="src/old.ts"
        targetType="file"
        onRenamed={onRenamed}
        onRenameFailed={onRenameFailed}
        onRenameConfirmed={onRenameConfirmed}
      />
    );

    const input = screen.getByLabelText('New name in src');
    fireEvent.change(input, { target: { value: 'new.ts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onRenamed).toHaveBeenCalledWith('src/old.ts', 'src/new.ts');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('computes correct new path for root file rename', () => {
    render(
      <RenameDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        targetPath="package.json"
        targetType="file"
        onRenamed={onRenamed}
      />
    );

    const input = screen.getByLabelText('New file name');
    fireEvent.change(input, { target: { value: 'app.json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onRenamed).toHaveBeenCalledWith('package.json', 'app.json');
  });

  it('shows validation error when name is unchanged', () => {
    render(
      <RenameDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        targetPath="package.json"
        targetType="file"
        onRenamed={onRenamed}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Name is unchanged')).toBeInTheDocument();
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it('rejects slashes in basename', () => {
    render(
      <RenameDialog
        open
        onOpenChange={onOpenChange}
        machineId="machine-1"
        workingDir="/workspace"
        targetPath="src/old.ts"
        targetType="file"
        onRenamed={onRenamed}
      />
    );

    const input = screen.getByLabelText('New name in src');
    fireEvent.change(input, { target: { value: 'nested/new.ts' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByText('Enter a name only')).toBeInTheDocument();
    expect(onRenamed).not.toHaveBeenCalled();
  });
});
