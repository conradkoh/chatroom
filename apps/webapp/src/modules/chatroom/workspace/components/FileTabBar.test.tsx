import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileTabBar } from './FileTabBar';
import type { FileTab } from '../hooks/useFileTabs';

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
    expect(bar.className).toMatch(/max-h-16/);
  });
});
