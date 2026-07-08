import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  WorkspaceHeaderRow,
  WorkspaceTabBarItem,
  WorkspaceTabBarShell,
  WORKSPACE_HEADER_ROW_BASE_CLASS,
  WORKSPACE_HEADER_ROW_CLASS,
  WORKSPACE_HEADER_ROW_HEIGHT_CLASS,
} from './WorkspaceTabBar';

function expectFixedHeaderHeight(className: string) {
  for (const token of WORKSPACE_HEADER_ROW_HEIGHT_CLASS.split(/\s+/)) {
    expect(className).toContain(token);
  }
}

describe('WorkspaceTabBar', () => {
  it('renders shell with shared wrap-capable container classes', () => {
    render(
      <WorkspaceTabBarShell testId="tab-bar-shell">
        <span>tab</span>
      </WorkspaceTabBarShell>
    );

    const bar = screen.getByTestId('tab-bar-shell');
    expect(bar.className).toMatch(/flex-wrap/);
    expectFixedHeaderHeight(bar.className);
    expect(bar.className).toMatch(/border-b-2/);
  });

  it('shell and header row share the fixed height contract', () => {
    expectFixedHeaderHeight(WORKSPACE_HEADER_ROW_CLASS);

    render(
      <WorkspaceTabBarShell testId="tab-bar-shell">
        <span>tab</span>
      </WorkspaceTabBarShell>
    );

    const bar = screen.getByTestId('tab-bar-shell');
    for (const token of WORKSPACE_HEADER_ROW_BASE_CLASS.split(/\s+/)) {
      expect(bar.className).toContain(token);
    }
    expectFixedHeaderHeight(bar.className);
  });

  it('header row component uses the same fixed height as tab bar shell', () => {
    render(
      <WorkspaceHeaderRow testId="content-toolbar">
        <span>actions</span>
      </WorkspaceHeaderRow>
    );

    const row = screen.getByTestId('content-toolbar');
    expectFixedHeaderHeight(row.className);
    expect(row.className).toMatch(/items-center/);
  });

  it('tab items fill the fixed row height without setting their own padding', () => {
    render(
      <WorkspaceTabBarShell testId="tab-bar-shell">
        <WorkspaceTabBarItem
          isActive
          label="a.ts"
          iconPath="a.ts"
          title="src/a.ts"
          onClick={vi.fn()}
          onClose={vi.fn()}
        />
      </WorkspaceTabBarShell>
    );

    const tab = screen.getByTitle('src/a.ts');
    expect(tab.className).toContain('h-full');
    expect(tab.className).not.toMatch(/py-1\.5/);
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
