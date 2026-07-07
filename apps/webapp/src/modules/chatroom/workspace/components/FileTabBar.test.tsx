import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileTabBar } from './FileTabBar';
import type { FileTab } from '../hooks/useFileTabs';

const tabs: FileTab[] = [
  { filePath: 'src/a.ts', name: 'a.ts', isPinned: true },
  { filePath: 'src/b.ts', name: 'b.ts', isPinned: true },
  { filePath: 'src/c.ts', name: 'c.ts', isPinned: false },
];

describe('FileTabBar', () => {
  it('calls onCloseOthers with the right-clicked tab path', async () => {
    const onCloseOthers = vi.fn();

    render(
      <FileTabBar
        tabs={tabs}
        activeTabPath="src/b.ts"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCloseOthers={onCloseOthers}
        onPin={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByTitle('src/b.ts'));

    const closeOthersItem = await screen.findByRole('menuitem', { name: /close others/i });
    fireEvent.click(closeOthersItem);

    expect(onCloseOthers).toHaveBeenCalledWith('src/b.ts');
  });

  it('disables Close Others when only one tab is open', async () => {
    const onCloseOthers = vi.fn();

    render(
      <FileTabBar
        tabs={[tabs[0]]}
        activeTabPath="src/a.ts"
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onCloseOthers={onCloseOthers}
        onPin={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByTitle('src/a.ts'));

    const closeOthersItem = await screen.findByRole('menuitem', { name: /close others/i });
    expect(closeOthersItem).toHaveAttribute('aria-disabled', 'true');
  });
});
