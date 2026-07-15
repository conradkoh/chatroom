import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileTabBar } from './FileTabBar';
import { RightPaneTabBar } from './RightPaneTabBar';
import { WORKSPACE_HEADER_ROW_HEIGHT_CLASS } from './WorkspaceTabBar';
import type { FileTab } from '../hooks/useFileTabs';
import { previewTabDoubleClickAction } from '../utils/explorerExpandHandlers';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const tabs: FileTab[] = [
  { filePath: 'src/a.ts', name: 'a.ts', isPinned: true },
  { filePath: 'src/b.ts', name: 'b.ts', isPinned: true },
  { filePath: 'src/c.ts', name: 'c.ts', isPinned: false },
];

const defaultProps = {
  tabs,
  activeTabPath: 'src/b.ts',
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

  it('disables Close Others when only one tab is open', async () => {
    const onCloseOthers = vi.fn();

    render(
      <FileTabBar
        {...defaultProps}
        tabs={[tabs[0]]}
        activeTabPath="src/a.ts"
        onCloseOthers={onCloseOthers}
      />
    );

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

  it('renders a wrap-capable tab bar container', () => {
    render(<FileTabBar {...defaultProps} />);

    const bar = screen.getByTestId('file-tab-bar');
    expect(bar.className).toMatch(/flex-wrap/);
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

  it('calls onTabDoubleClick for preview tabs in RightPaneTabBar', () => {
    const onTabDoubleClick = vi.fn();
    const previewTab = {
      key: 'preview:src/a.md',
      name: 'Preview',
      filePath: 'src/a.md',
      viewType: 'preview' as const,
    };

    render(
      <RightPaneTabBar
        tabs={[previewTab]}
        activeTabKey="preview:src/a.md"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onTabDoubleClick={onTabDoubleClick}
      />
    );

    fireEvent.doubleClick(screen.getByTitle('src/a.md'));

    expect(onTabDoubleClick).toHaveBeenCalledWith(previewTab);
  });

  it('preview tab double-click should target preview expand not editor expand', () => {
    const result = previewTabDoubleClickAction('preview', 'src/a.md');
    expect(result?.action).toBe('togglePreviewExpanded');
    expect(result?.action).not.toBe('toggleExpanded');
  });

  it('RightPaneTabBar uses the same shared tab bar shell', () => {
    const { unmount: unmountFileBar } = render(<FileTabBar {...defaultProps} />);
    const fileBarClass = screen.getByTestId('file-tab-bar').className;
    unmountFileBar();

    render(
      <RightPaneTabBar
        tabs={[
          { key: 'preview:src/a.md', name: 'Preview', filePath: 'src/a.md', viewType: 'preview' },
        ]}
        activeTabKey="preview:src/a.md"
        onActivate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('right-pane-tab-bar').className).toBe(fileBarClass);
  });
});
