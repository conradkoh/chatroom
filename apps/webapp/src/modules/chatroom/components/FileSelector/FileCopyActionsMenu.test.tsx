import { fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FileCopyActionsMenu } from './FileCopyActionsMenu';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const writeText = vi.fn();

const defaultProps = {
  relativePath: 'src/foo.ts',
  workingDir: '/workspace/project',
  content: 'file body',
  truncated: false,
  contentDisabled: false,
};

function openDropdown() {
  const trigger = screen.getByRole('button', { name: /copy file/i });
  fireEvent.pointerDown(trigger);
  // Radix dropdown opens on pointerDown; menu items rendered in a portal
}

describe('FileCopyActionsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('renders trigger button with copy icon', () => {
    render(<FileCopyActionsMenu {...defaultProps} />);
    expect(screen.getByRole('button', { name: /copy file/i })).toBeInTheDocument();
  });

  it('shows all four menu items when dropdown is opened', () => {
    render(<FileCopyActionsMenu {...defaultProps} />);
    openDropdown();
    expect(screen.getByText('Copy File Name')).toBeInTheDocument();
    expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
    expect(screen.getByText('Copy Full Path')).toBeInTheDocument();
    expect(screen.getByText('Copy File Content')).toBeInTheDocument();
  });

  it('copies file name to clipboard and shows toast on "Copy File Name" click', async () => {
    render(<FileCopyActionsMenu {...defaultProps} />);
    openDropdown();
    fireEvent.click(screen.getByText('Copy File Name'));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('foo.ts');
      expect(toast.success).toHaveBeenCalledWith('Copied file name');
    });
  });

  it('disables Copy Full Path when workingDir is null', () => {
    render(<FileCopyActionsMenu {...defaultProps} workingDir={null} />);
    openDropdown();
    expect(screen.getByRole('menuitem', { name: /copy full path/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('disables Copy File Content when content is null', () => {
    render(<FileCopyActionsMenu {...defaultProps} content={null} />);
    openDropdown();
    expect(screen.getByRole('menuitem', { name: /copy file content/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('disables Copy File Content when contentDisabled is true', () => {
    render(<FileCopyActionsMenu {...defaultProps} contentDisabled />);
    openDropdown();
    expect(screen.getByRole('menuitem', { name: /copy file content/i })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('copies relative path to clipboard on "Copy Relative Path" click', async () => {
    render(<FileCopyActionsMenu {...defaultProps} />);
    openDropdown();
    fireEvent.click(screen.getByText('Copy Relative Path'));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('src/foo.ts');
      expect(toast.success).toHaveBeenCalledWith('Copied relative path');
    });
  });
});
