import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FileCopyActionsMenu,
  CopyFileNameButton,
  CopyFileContentButton,
} from './FileCopyActionsMenu';

const writeText = vi.fn();

const defaultProps = {
  relativePath: 'src/foo.ts',
  workingDir: '/workspace/project',
  content: 'file body',
  contentStatus: 'ready' as const,
  contentDisabled: false,
};

function openDropdown() {
  const trigger = screen.getByRole('button', { name: /copy file/i });
  fireEvent.click(trigger);
  // Base UI menu opens on click; menu items rendered in a portal
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders trigger button with copy icon', () => {
    render(<FileCopyActionsMenu {...defaultProps} />);
    expect(screen.getByRole('button', { name: /copy file/i })).toBeInTheDocument();
  });

  it('shows all four menu items with section labels when dropdown is opened', () => {
    render(<FileCopyActionsMenu {...defaultProps} onOpenInExplorer={vi.fn()} />);
    openDropdown();
    expect(screen.getByText('Path')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Copy File Name')).toBeInTheDocument();
    expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
    expect(screen.getByText('Copy Full Path')).toBeInTheDocument();
    expect(screen.getByText('Open in Explorer')).toBeInTheDocument();
    expect(screen.getByText('Copy File Content')).toBeInTheDocument();
  });

  it('copies file name to clipboard on "Copy File Name" click', async () => {
    render(<FileCopyActionsMenu {...defaultProps} />);
    openDropdown();
    fireEvent.click(screen.getByText('Copy File Name'));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('foo.ts');
    });
  });

  it('flips the trigger to a check icon for 2 s after "Copy File Name" succeeds', async () => {
    vi.useFakeTimers();
    render(<FileCopyActionsMenu {...defaultProps} />);
    openDropdown();
    const trigger = screen.getByRole('button', { name: /copy file/i });

    await act(async () => {
      fireEvent.click(screen.getByText('Copy File Name'));
    });

    expect(writeText).toHaveBeenCalledWith('foo.ts');
    expect(trigger.querySelector('svg.lucide-check')).not.toBeNull();
    expect(screen.queryByText(/Copied/)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(trigger.querySelector('svg.lucide-check')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(trigger.querySelector('svg.lucide-check')).toBeNull();
  });

  it('reports a rejected copy to onCopyError and leaves the trigger on the copy icon', async () => {
    const onCopyError = vi.fn();
    writeText.mockRejectedValueOnce(new Error('denied'));

    render(<FileCopyActionsMenu {...defaultProps} onCopyError={onCopyError} />);
    openDropdown();
    const trigger = screen.getByRole('button', { name: /copy file/i });

    await act(async () => {
      fireEvent.click(screen.getByText('Copy File Name'));
    });

    expect(onCopyError).toHaveBeenCalledTimes(1);
    expect(onCopyError).toHaveBeenCalledWith('Failed to copy to clipboard');
    expect(trigger.querySelector('svg.lucide-check')).toBeNull();
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
    fireEvent.click(trigger);
    expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
    expect(screen.queryByText('Copy File Content')).not.toBeInTheDocument();
  });

  it('renders Open in Explorer item when onOpenInExplorer is provided', () => {
    const onOpenInExplorer = vi.fn();
    render(
      <FileCopyActionsMenu
        {...defaultProps}
        onOpenInExplorer={onOpenInExplorer}
        showFileContent={false}
      />
    );
    openDropdown();
    expect(screen.getByText('Open in Explorer')).toBeInTheDocument();
  });

  it('calls onOpenInExplorer callback when Open in Explorer is clicked', () => {
    const onOpenInExplorer = vi.fn();
    render(
      <FileCopyActionsMenu
        {...defaultProps}
        onOpenInExplorer={onOpenInExplorer}
        showFileContent={false}
      />
    );
    openDropdown();
    fireEvent.click(screen.getByText('Open in Explorer'));
    expect(onOpenInExplorer).toHaveBeenCalledTimes(1);
  });

  it('omits Open in Explorer when onOpenInExplorer is undefined', () => {
    render(<FileCopyActionsMenu {...defaultProps} />);
    openDropdown();
    expect(screen.queryByText('Open in Explorer')).not.toBeInTheDocument();
  });

  it('renders Path and Content section labels', () => {
    render(<FileCopyActionsMenu {...defaultProps} onOpenInExplorer={vi.fn()} />);
    openDropdown();
    expect(screen.getByText('Path')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('omits Content section when showFileContent is false', () => {
    render(
      <FileCopyActionsMenu {...defaultProps} showFileContent={false} onOpenInExplorer={vi.fn()} />
    );
    openDropdown();
    expect(screen.getByText('Path')).toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
    expect(screen.getByText('Open in Explorer')).toBeInTheDocument();
  });
});

describe('FileCopyActionsMenu content copy reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('forwards truncation of copied file content to onCopied', async () => {
    const onCopied = vi.fn();
    render(<FileCopyActionsMenu {...defaultProps} contentTruncated onCopied={onCopied} />);
    openDropdown();
    fireEvent.click(screen.getByText('Copy File Content'));
    await vi.waitFor(() => {
      expect(onCopied).toHaveBeenCalledWith({ truncated: true });
    });
    expect(writeText).toHaveBeenCalledWith('file body');
  });

  it('reports complete file content to onCopied as not truncated', async () => {
    const onCopied = vi.fn();
    render(<FileCopyActionsMenu {...defaultProps} contentTruncated={false} onCopied={onCopied} />);
    openDropdown();
    fireEvent.click(screen.getByText('Copy File Content'));
    await vi.waitFor(() => {
      expect(onCopied).toHaveBeenCalledWith({ truncated: false });
    });
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
    });
  });

  it('flips to a check icon for 2 s after a successful copy', async () => {
    vi.useFakeTimers();
    render(<CopyFileNameButton relativePath="src/foo.ts" />);
    const button = screen.getByRole('button', { name: /copy file name/i });

    await act(async () => {
      fireEvent.click(button);
    });

    expect(writeText).toHaveBeenCalledWith('foo.ts');
    expect(button.querySelector('svg.lucide-check')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(button.querySelector('svg.lucide-check')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(button.querySelector('svg.lucide-check')).toBeNull();
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
    });
  });

  it('reports a rejected copy to onCopyError', async () => {
    const onCopyError = vi.fn();
    writeText.mockRejectedValueOnce(new Error('denied'));

    render(
      <CopyFileContentButton
        content="hello"
        label="Copy File Content"
        className="flex"
        onCopyError={onCopyError}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy file content/i }));
    });

    expect(onCopyError).toHaveBeenCalledTimes(1);
    expect(onCopyError).toHaveBeenCalledWith('Failed to copy to clipboard');
  });
});
