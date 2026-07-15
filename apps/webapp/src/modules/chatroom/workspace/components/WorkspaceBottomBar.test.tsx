import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkspaceBottomBarShell } from './WorkspaceBottomBar';

describe('WorkspaceBottomBarShell', () => {
  it('reserves safe-area padding outside a fixed-height content row', () => {
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );

    const outer = screen.getByTestId('workspace-bottom-bar');
    // Outer owns shrink-0 so it can grow with safe-area padding
    expect(outer.className).toContain('shrink-0');
    // Outer does NOT have fixed h-8 — that belongs to inner
    expect(outer.className).not.toMatch(/\bh-8\b/);

    // Inner element has fixed h-8 content height
    const inner = outer.firstElementChild as HTMLElement;
    expect(inner).toBeTruthy();
    expect(inner.className).toMatch(/\bh-8\b/);
    expect(inner.className).toContain('min-h-[32px]');
  });
});
