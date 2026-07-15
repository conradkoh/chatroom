import { fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FileCopyActionsMenu,
  CopyFileNameButton,
  CopyFileContentButton,
} from './FileCopyActionsMenu';

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

  it('omits Copy File Name when showFileName is false', () => {
    render(<FileCopyActionsMenu {...defaultProps} showFileName={false} />);
    openDropdown();
    expect(screen.queryByText('Copy File Name')).not.toBeInTheDocument();
    expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
  });

  it('uses custom file content label', () => {
    render(<FileCopyActionsMenu {...defaultProps} fileContentLabel="Copy as Markdown" />);
    openDropdown();
    expect(screen.getByText('Copy as Markdown')).toBeInTheDocument();
    expect(screen.queryByText('Copy File Content')).not.toBeInTheDocument();
  });

  it('omits file content item when showFileContent is false', () => {
    render(<FileCopyActionsMenu {...defaultProps} showFileContent={false} />);
    openDropdown();
    expect(screen.queryByText('Copy File Content')).not.toBeInTheDocument();
  });

  it('uses MoreHorizontal trigger when triggerVariant is more', () => {
    render(<FileCopyActionsMenu {...defaultProps} triggerVariant="more" showFileContent={false} />);
    const trigger = screen.getByRole('button', { name: /more copy options/i });
    fireEvent.pointerDown(trigger);
    expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
    expect(screen.queryByText('Copy File Content')).not.toBeInTheDocument();
  });
});

describe('CopyFileNameButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('copies file name when clicked', async () => {
    render(<CopyFileNameButton relativePath="src/foo.ts" />);
    fireEvent.click(screen.getByRole('button', { name: /copy file name/i }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('foo.ts');
      expect(toast.success).toHaveBeenCalledWith('Copied file name');
    });
  });
});

describe('CopyFileContentButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('renders visible label text', () => {
    render(<CopyFileContentButton content="hello" label="Copy as Markdown" className="flex" />);
    expect(screen.getByRole('button', { name: /copy as markdown/i })).toHaveTextContent(
      'Copy as Markdown'
    );
  });

  it('copies content when clicked', async () => {
    render(<CopyFileContentButton content="hello" label="Copy File Content" className="flex" />);
    fireEvent.click(screen.getByRole('button', { name: /copy file content/i }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hello');
      expect(toast.success).toHaveBeenCalledWith('Copied file content');
    });
  });
});
