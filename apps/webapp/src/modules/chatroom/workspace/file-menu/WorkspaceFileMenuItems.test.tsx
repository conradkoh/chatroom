import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceFileMenuProps } from './types';
import { WorkspaceFileMenuItems } from './WorkspaceFileMenuItems';
import {
  exportFileAsDocx,
  exportFileAsPdf,
  saveTextFile,
  type SaveFileResult,
} from '../../lib/messageExport';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

vi.mock('../../lib/messageExport', async () => {
  const formats = (await vi.importActual('../../lib/messageExport/downloadFormats')) as Record<
    string,
    unknown
  >;
  return {
    ...formats,
    saveTextFile: vi.fn().mockResolvedValue('saved'),
    exportFileAsDocx: vi.fn().mockResolvedValue('saved'),
    exportFileAsPdf: vi.fn().mockResolvedValue('saved'),
  };
});

const writeText = vi.fn();

const defaultState = {
  relativePath: 'src/foo.ts',
  workingDir: '/workspace/project',
  content: 'file body',
};

const defaultHandlers = {
  onOpenInExplorer: vi.fn(),
  onOpenFileOnRemote: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onCloseOthers: vi.fn(),
  onNewFile: vi.fn(),
  onNewFolder: vi.fn(),
};

const defaultVisibility: WorkspaceFileMenuProps['visibility'] = {
  copyFileName: true,
  copyRelativePath: true,
  copyFullPath: true,
  copyFileContent: true,
  openInExplorer: true,
  openFileOnRemote: true,
  rename: true,
  delete: true,
  closeOthers: true,
  newFile: true,
  newFolder: true,
};

function renderMenu(overrides: Partial<WorkspaceFileMenuProps> = {}) {
  return render(
    <DropdownMenu open={true} onOpenChange={vi.fn()} modal={false}>
      <DropdownMenuTrigger type="button">open</DropdownMenuTrigger>
      <DropdownMenuContent>
        <WorkspaceFileMenuItems
          state={{ ...defaultState, ...overrides.state }}
          handlers={{ ...defaultHandlers, ...overrides.handlers }}
          visibility={{ ...defaultVisibility, ...overrides.visibility }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('WorkspaceFileMenuItems', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('renders all sections with visible items', () => {
    renderMenu();
    expect(screen.getByText('New File')).toBeInTheDocument();
    expect(screen.getByText('New Folder')).toBeInTheDocument();
    expect(screen.getByText('Path')).toBeInTheDocument();
    expect(screen.getByText('Copy File Name')).toBeInTheDocument();
    expect(screen.getByText('Copy Relative Path')).toBeInTheDocument();
    expect(screen.getByText('Copy Full Path')).toBeInTheDocument();
    expect(screen.getByText('Open in Explorer')).toBeInTheDocument();
    expect(screen.getByText('Open File on Remote')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
    expect(screen.getByText('Copy File Content')).toBeInTheDocument();
    expect(screen.getByText('Rename')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Close Others')).toBeInTheDocument();
  });

  it('omits sections with no visible items', () => {
    renderMenu({
      visibility: {
        copyFileName: true,
        copyRelativePath: true,
        copyFullPath: true,
        copyFileContent: false,
        openInExplorer: false,
        openFileOnRemote: false,
        rename: false,
        delete: false,
        closeOthers: false,
        newFile: false,
        newFolder: false,
      },
    });
    expect(screen.queryByText('New File')).not.toBeInTheDocument();
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
    expect(screen.queryByText('Rename')).not.toBeInTheDocument();
    expect(screen.queryByText('Close Others')).not.toBeInTheDocument();
    expect(screen.getByText('Path')).toBeInTheDocument();
    expect(screen.getByText('Copy File Name')).toBeInTheDocument();
  });

  it('renders custom file content label', () => {
    renderMenu({
      state: { ...defaultState, fileContentLabel: 'Copy as Markdown' },
    });
    expect(screen.getByText('Copy as Markdown')).toBeInTheDocument();
  });
});

describe('WorkspaceFileMenuItems copy reporting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('reports truncated file content to onCopied as truncated', async () => {
    const onCopied = vi.fn();
    renderMenu({
      state: { ...defaultState, contentTruncated: true },
      handlers: { onCopied },
    });
    fireEvent.click(screen.getByText('Copy File Content'));
    await vi.waitFor(() => {
      expect(onCopied).toHaveBeenCalledWith({ truncated: true });
    });
    expect(writeText).toHaveBeenCalledWith('file body');
    expect(screen.queryByText(/truncated/i)).not.toBeInTheDocument();
  });

  it('reports complete file content to onCopied as not truncated', async () => {
    const onCopied = vi.fn();
    renderMenu({
      state: { ...defaultState, contentTruncated: false },
      handlers: { onCopied },
    });
    fireEvent.click(screen.getByText('Copy File Content'));
    await vi.waitFor(() => {
      expect(onCopied).toHaveBeenCalledWith({ truncated: false });
    });
  });

  it('reports a file name copy as not truncated even when the content is truncated', async () => {
    const onCopied = vi.fn();
    renderMenu({
      state: { ...defaultState, contentTruncated: true },
      handlers: { onCopied },
    });
    fireEvent.click(screen.getByText('Copy File Name'));
    await vi.waitFor(() => {
      expect(onCopied).toHaveBeenCalledWith({ truncated: false });
    });
    expect(writeText).toHaveBeenCalledWith('foo.ts');
  });
});

const markdownState = {
  relativePath: 'docs/README.md',
  workingDir: '/workspace/project',
  content: 'file body',
  contentStatus: 'ready' as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('WorkspaceFileMenuItems download section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.mocked(saveTextFile).mockResolvedValue('saved');
    vi.mocked(exportFileAsDocx).mockResolvedValue('saved');
  });

  it('lists the three download rows for a ready markdown file, between Content and the file actions', () => {
    renderMenu({ state: markdownState });

    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download as Markdown' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download as DOCX' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download as PDF' })).toBeInTheDocument();

    expect(isBefore(screen.getByText('Path'), screen.getByText('Content'))).toBe(true);
    expect(isBefore(screen.getByText('Content'), screen.getByText('Download'))).toBe(true);
    expect(isBefore(screen.getByText('Download'), screen.getByText('Rename'))).toBe(true);
  });

  it('hides the download section for a non-markdown file', () => {
    renderMenu();
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Download as Markdown' })).toBeNull();
  });

  it('hides the download section for a directory node', () => {
    renderMenu({ state: { ...markdownState, nodeType: 'directory' } });
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
  });

  it('shows one muted reason and disables every row for a truncated file', () => {
    renderMenu({ state: { ...markdownState, contentTruncated: true } });

    const reasons = screen.getAllByTestId('workspace-download-disabled-reason');
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toHaveTextContent('File is larger than the 500 KB preview limit.');
    for (const name of ['Download as Markdown', 'Download as DOCX', 'Download as PDF']) {
      expect(screen.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('keeps every row enabled for an empty markdown file', () => {
    renderMenu({ state: { ...markdownState, content: '' } });

    for (const name of ['Download as Markdown', 'Download as DOCX', 'Download as PDF']) {
      expect(screen.getByRole('menuitem', { name })).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('shows the DOCX busy label on the active row only and disables every row', async () => {
    const onRequestClose = vi.fn();
    const pending = deferred<'saved'>();
    vi.mocked(exportFileAsDocx).mockReturnValueOnce(pending.promise);
    renderMenu({ state: markdownState, handlers: { onRequestClose } });

    fireEvent.click(screen.getByText('Download as DOCX'));

    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Preparing DOCX...' })).toBeInTheDocument()
    );
    expect(screen.getByRole('menuitem', { name: 'Preparing DOCX...' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'Download as Markdown' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'Download as PDF' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.queryByText('Preparing PDF...')).not.toBeInTheDocument();
    expect(exportFileAsDocx).toHaveBeenCalledWith('docs/README.md', 'file body');

    pending.resolve('saved');
    await waitFor(() => expect(onRequestClose).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: 'Preparing DOCX...' })).not.toBeInTheDocument()
    );
  });

  it('saves markdown bytes under the source base name', async () => {
    renderMenu({ state: markdownState });

    fireEvent.click(screen.getByText('Download as Markdown'));

    await waitFor(() =>
      expect(saveTextFile).toHaveBeenCalledWith('README.md', 'file body', 'text/markdown', [
        '.md',
        '.markdown',
        '.mdx',
      ])
    );
  });
});

describe('WorkspaceFileMenuItems download in-flight state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.mocked(saveTextFile).mockResolvedValue('saved');
    vi.mocked(exportFileAsDocx).mockResolvedValue('saved');
    vi.mocked(exportFileAsPdf).mockResolvedValue('saved');
  });

  it('keeps every download row disabled after the menu closes and reopens mid-run', async () => {
    const pending = deferred<SaveFileResult>();
    vi.mocked(exportFileAsDocx).mockReturnValueOnce(pending.promise);
    const first = renderMenu({ state: markdownState });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as DOCX' }));
    await screen.findByRole('menuitem', { name: 'Preparing DOCX...' });
    first.unmount(); // Escape or outside click unmounts the menu content

    renderMenu({ state: markdownState });
    expect(await screen.findByRole('menuitem', { name: 'Preparing DOCX...' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'Download as Markdown' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    expect(screen.getByRole('menuitem', { name: 'Download as PDF' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as PDF' }));
    expect(exportFileAsPdf).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve('saved');
      await pending.promise;
    });
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Download as DOCX' })).not.toHaveAttribute(
        'aria-disabled',
        'true'
      )
    );
  });
});
