import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceTabBarItem, WorkspaceTabBarShell } from './WorkspaceTabBar';

describe('WorkspaceTabBar', () => {
  it('renders shell with shared wrap-capable container classes', () => {
    render(
      <WorkspaceTabBarShell testId="tab-bar-shell">
        <span>tab</span>
      </WorkspaceTabBarShell>
    );

    const bar = screen.getByTestId('tab-bar-shell');
    expect(bar.className).toMatch(/flex-wrap/);
    expect(bar.className).toMatch(/min-h-8/);
    expect(bar.className).toMatch(/max-h-16/);
    expect(bar.className).toMatch(/border-b-2/);
  });

  it('renders tab item with consistent active styling', () => {
    render(
      <WorkspaceTabBarItem
        isActive
        label="preview.md"
        iconPath="preview.md"
        title="src/preview.md"
        onClick={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('preview.md')).toBeInTheDocument();
    expect(screen.getByTitle('src/preview.md').className).toMatch(/border-b-chatroom-accent/);
  });
});
