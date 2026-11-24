import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { FileTabBar } from './FileTabBar';
import { WORKSPACE_HEADER_ROW_HEIGHT_CLASS } from './WorkspaceTabBar';
import { exportFileAsDocx } from '../../lib/messageExport';
import { useFileContent } from '../hooks/useFileContent';
import type { EditorTab } from '../hooks/useFileTabs';
import { previewTabDoubleClickAction } from '../utils/explorerExpandHandlers';

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

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: () => undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { workspaceFiles: { requestFileContent: {}, getFileContentV2: {} } },
}));

vi.mock('../hooks/useFileContent', () => ({
  useFileContent: vi.fn(() => null),
}));

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

const tabs: EditorTab[] = [
  { kind: 'file', filePath: 'src/a.ts', name: 'a.ts', isPinned: true },
  { kind: 'file', filePath: 'src/b.ts', name: 'b.ts', isPinned: true },
  { kind: 'file', filePath: 'src/c.ts', name: 'c.ts', isPinned: false },
];

const defaultProps = {
  tabs,
  activeTabKey: 'src/b.ts',
  machineId: 'machine-1' as string | null,
  workingDir: '/workspace/project' as string | null,
  onActivate: vi.fn(),
  onClose: vi.fn(),
  onCloseOthers: vi.fn(),
  onPin: vi.fn(),
};

describe('FileTabBar', () => {
  it('calls onCloseOthers with the right-clicked tab path', async () => {
    const onCloseOthers = vi.fn();

    render(<FileTabBar {...defaultProps} onCloseOthers={onCloseOthers} />);

    fireEvent.contextMenu(screen.getByTitle('src/b.ts'));

    const closeOthersItem = await screen.findByRole('menuitem', { name: /close others/i });
    fireEvent.click(closeOthersItem);

    expect(onCloseOthers).toHaveBeenCalledWith('src/b.ts');
  });

  it('shows Close Others on agentic query tab right-click', async () => {
    const onCloseOthers = vi.fn();
    const agenticTabs: EditorTab[] = [
      {
        kind: 'agentic-query',
        queryId: 'query-1',
        name: 'Agentic Search',
        mode: 'search',
        isPinned: true,
      },
      { kind: 'file', filePath: 'src/a.ts', name: 'a.ts', isPinned: true },
    ];

    render(
      <FileTabBar
        {...defaultProps}
        tabs={agenticTabs}
        activeTabKey="agentic-query:query-1"
        onCloseOthers={onCloseOthers}
      />
    );

    fireEvent.contextMenu(screen.getByTitle('agentic-query:query-1'));

    const closeOthersItem = await screen.findByRole('menuitem', { name: /close others/i });
    expect(closeOthersItem).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /copy file name/i })).not.toBeInTheDocument();

    fireEvent.click(closeOthersItem);
    expect(onCloseOthers).toHaveBeenCalledWith('agentic-query:query-1');
  });

  it('scrolls active tab into view when activeTabKey changes', () => {
    const { rerender } = render(<FileTabBar {...defaultProps} activeTabKey="src/a.ts" />);

    rerender(<FileTabBar {...defaultProps} activeTabKey="src/c.ts" />);

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('disables Close Others when only one tab is open', async () => {
    render(<FileTabBar {...defaultProps} tabs={[tabs[0]]} />);

    fireEvent.contextMenu(screen.getByTitle('src/a.ts'));

    const closeOthersItem = await screen.findByRole('menuitem', { name: /close others/i });
    expect(closeOthersItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('copies relative path from context menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<FileTabBar {...defaultProps} />);

    fireEvent.contextMenu(screen.getByTitle('src/b.ts'));
    fireEvent.click(await screen.findByText('Copy Relative Path'));

    expect(writeText).toHaveBeenCalledWith('src/b.ts');
  });

  it('reports a rejected relative-path copy to onCopyError', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onCopyError = vi.fn();
    const onCopied = vi.fn();

    render(<FileTabBar {...defaultProps} onCopied={onCopied} onCopyError={onCopyError} />);

    fireEvent.contextMenu(screen.getByTitle('src/b.ts'));
    fireEvent.click(await screen.findByText('Copy Relative Path'));

    await vi.waitFor(() => {
      expect(onCopyError).toHaveBeenCalledTimes(1);
    });
    expect(onCopyError).toHaveBeenCalledWith('Failed to copy to clipboard');
    expect(onCopied).not.toHaveBeenCalled();
  });

  it('copies file name from context menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<FileTabBar {...defaultProps} />);

    fireEvent.contextMenu(screen.getByTitle('src/b.ts'));
    fireEvent.click(await screen.findByText('Copy File Name'));

    expect(writeText).toHaveBeenCalledWith('b.ts');
  });

  it('copies full path from context menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(<FileTabBar {...defaultProps} />);

    fireEvent.contextMenu(screen.getByTitle('src/b.ts'));
    fireEvent.click(await screen.findByText('Copy Full Path'));

    expect(writeText).toHaveBeenCalledWith('/workspace/project/src/b.ts');
  });

  it('disables Copy Full Path when workingDir is null', async () => {
    render(<FileTabBar {...defaultProps} workingDir={null} />);

    fireEvent.contextMenu(screen.getByTitle('src/b.ts'));

    const copyFullPathItem = await screen.findByRole('menuitem', { name: /copy full path/i });
    expect(copyFullPathItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the correct content label when switching tab context menus', async () => {
    const mixedTabs: EditorTab[] = [
      { kind: 'file', filePath: 'data.json', name: 'data.json', isPinned: true },
      { kind: 'file', filePath: 'readme.md', name: 'readme.md', isPinned: true },
    ];

    vi.mocked(useFileContent).mockImplementation((args) => {
      if (args === 'skip') return null;
      if (args.filePath === 'data.json') {
        return { content: '{"a":1}', encoding: 'utf-8', truncated: false, fetchedAt: 1 };
      }
      if (args.filePath === 'readme.md') {
        return { content: '# Hello', encoding: 'utf-8', truncated: false, fetchedAt: 2 };
      }
      return null;
    });

    render(<FileTabBar {...defaultProps} tabs={mixedTabs} activeTabKey="readme.md" />);

    fireEvent.contextMenu(screen.getByTitle('data.json'));
    fireEvent.contextMenu(screen.getByTitle('readme.md'));

    expect(await screen.findByRole('menuitem', { name: /copy as markdown/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: /^copy file content$/i })
    ).not.toBeInTheDocument();
  });

  it('renders a single-row horizontal scroll tab bar container', () => {
    render(<FileTabBar {...defaultProps} />);

    const bar = screen.getByTestId('file-tab-bar');
    expect(bar.className).toMatch(/flex-nowrap/);
    expect(bar.className).toMatch(/overflow-x-auto/);
    expect(bar.className).not.toMatch(/flex-wrap/);
    for (const token of WORKSPACE_HEADER_ROW_HEIGHT_CLASS.split(/\s+/)) {
      expect(bar.className).toContain(token);
    }
  });

  it('calls onToggleExpanded when double-clicking a pinned tab', () => {
    const onToggleExpanded = vi.fn();

    render(<FileTabBar {...defaultProps} onToggleExpanded={onToggleExpanded} />);

    fireEvent.doubleClick(screen.getByTitle('src/a.ts'));

    expect(onToggleExpanded).toHaveBeenCalledWith('src/a.ts');
  });

  it('calls onPin when double-clicking an unpinned tab', () => {
    const onPin = vi.fn();

    render(<FileTabBar {...defaultProps} onPin={onPin} />);

    fireEvent.doubleClick(screen.getByTitle('src/c.ts'));

    expect(onPin).toHaveBeenCalledWith('src/c.ts');
  });

  it('preview tab double-click should target preview expand not editor expand', () => {
    const result = previewTabDoubleClickAction('preview', 'src/a.md');
    expect(result?.action).toBe('togglePreviewExpanded');
    expect(result?.action).not.toBe('toggleExpanded');
  });
});

describe('FileTabBar copy reporting', () => {
  function stubClipboard(writeText: (text: string) => Promise<void>) {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  }

  function mockFileContent(truncated: boolean) {
    vi.mocked(useFileContent).mockReturnValue({
      content: 'file body',
      encoding: 'utf8',
      truncated,
      fetchedAt: 1,
    });
  }

  async function copyFileContentFromTab() {
    fireEvent.contextMenu(screen.getByTitle('src/b.ts'));
    fireEvent.click(await screen.findByRole('menuitem', { name: /copy file content/i }));
  }

  it('reports a truncated file content copy to onCopied as truncated', async () => {
    mockFileContent(true);
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const onCopied = vi.fn();

    render(<FileTabBar {...defaultProps} onCopied={onCopied} />);
    await copyFileContentFromTab();

    await waitFor(() => expect(onCopied).toHaveBeenCalledWith({ truncated: true }));
  });

  it('reports a complete file content copy to onCopied as not truncated', async () => {
    mockFileContent(false);
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const onCopied = vi.fn();

    render(<FileTabBar {...defaultProps} onCopied={onCopied} />);
    await copyFileContentFromTab();

    await waitFor(() => expect(onCopied).toHaveBeenCalledWith({ truncated: false }));
  });

  afterEach(() => {
    vi.mocked(useFileContent).mockReturnValue(null);
  });
});

describe('FileTabBar markdown downloads', () => {
  const markdownTabs: EditorTab[] = [
    { kind: 'file', filePath: 'docs/README.md', name: 'README.md', isPinned: true },
    {
      kind: 'preview',
      filePath: 'docs/README.md',
      name: 'README.md (Preview)',
      isPinned: true,
    },
  ];

  const markdownProps = {
    ...defaultProps,
    tabs: markdownTabs,
    activeTabKey: 'docs/README.md',
  };

  function mockReadyMarkdown() {
    vi.mocked(useFileContent).mockReturnValue({
      content: '# Hello',
      encoding: 'utf-8',
      truncated: false,
      fetchedAt: 1,
    });
  }

  async function collectMenuItems() {
    const items = await screen.findAllByRole('menuitem');
    return items.map((item) => ({
      name: item.textContent?.trim() ?? '',
      disabled: item.getAttribute('aria-disabled') === 'true',
    }));
  }

  it('renders the same item set for a markdown file tab and its preview tab', async () => {
    mockReadyMarkdown();

    render(<FileTabBar {...markdownProps} />);
    fireEvent.contextMenu(screen.getAllByTitle('docs/README.md')[0]);
    const fileTabItems = await collectMenuItems();

    cleanup();

    render(<FileTabBar {...markdownProps} />);
    fireEvent.contextMenu(screen.getAllByTitle('docs/README.md')[1]);
    const previewTabItems = await collectMenuItems();

    expect(previewTabItems).toEqual(fileTabItems);

    const fileTabNames = fileTabItems.map((item) => item.name);
    expect(fileTabNames.filter((name) => name.startsWith('Download as'))).toEqual([
      'Download as Markdown',
      'Download as DOCX',
      'Download as PDF',
    ]);
    expect(fileTabItems.at(-1)).toMatchObject({ name: 'Close Others', disabled: false });
  });

  it('shows the loading reason while content resolves and the not-found reason when missing', async () => {
    vi.mocked(useFileContent).mockReturnValue(undefined);
    render(<FileTabBar {...markdownProps} />);
    fireEvent.contextMenu(screen.getAllByTitle('docs/README.md')[0]);

    expect(await screen.findByText('Loading file content…')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download as Markdown' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    cleanup();

    vi.mocked(useFileContent).mockReturnValue(null);
    render(<FileTabBar {...markdownProps} />);
    fireEvent.contextMenu(screen.getAllByTitle('docs/README.md')[0]);

    expect(await screen.findByText('File not found.')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Download as PDF' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('shows no Download group on a non-markdown file tab', async () => {
    render(<FileTabBar {...defaultProps} />);

    fireEvent.contextMenu(screen.getByTitle('src/b.ts'));

    expect(await screen.findByRole('menuitem', { name: /copy file content/i })).toBeInTheDocument();
    expect(screen.queryByText('Download')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('menuitem', { name: /download as markdown/i })
    ).not.toBeInTheDocument();
  });

  it('reports a failed DOCX download to onDownloadError', async () => {
    mockReadyMarkdown();
    vi.mocked(exportFileAsDocx).mockRejectedValueOnce(new Error('boom'));
    const onDownloadStart = vi.fn();
    const onDownloadError = vi.fn();

    render(
      <FileTabBar
        {...markdownProps}
        onDownloadStart={onDownloadStart}
        onDownloadError={onDownloadError}
      />
    );
    fireEvent.contextMenu(screen.getAllByTitle('docs/README.md')[0]);
    fireEvent.click(await screen.findByText('Download as DOCX'));

    await waitFor(() => expect(onDownloadError).toHaveBeenCalledWith('Failed to prepare DOCX'));
    expect(onDownloadStart).toHaveBeenCalled();
  });

  afterEach(() => {
    vi.mocked(useFileContent).mockReturnValue(null);
  });
});
