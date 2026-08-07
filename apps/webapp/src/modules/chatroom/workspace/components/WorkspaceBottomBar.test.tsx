import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceBottomBarShell } from './WorkspaceBottomBar';

const mockUseIsDesktop = vi.fn();

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('../../components/shared/chatroomMobileSafeArea', () => ({
  getChatroomMobileFooterSafeAreaStyle: (mobile: boolean) =>
    mobile
      ? {
          paddingLeft: '12px',
          paddingRight: '13px',
          paddingBottom: '14px',
        }
      : {},
}));

describe('WorkspaceBottomBarShell', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
  });

  it('uses opaque primary background instead of translucent surface', () => {
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );

    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.className).toContain('bg-chatroom-bg-primary');
    expect(outer.className).not.toContain('bg-chatroom-bg-surface');
  });

  it('adds horizontal and bottom safe-area padding on mobile', () => {
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );

    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.paddingLeft).toBe('12px');
    expect(outer.style.paddingRight).toBe('13px');
    expect(outer.style.paddingBottom).toBe('14px');
  });

  it('does not add safe-area padding on desktop', () => {
    mockUseIsDesktop.mockReturnValue(true);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );

    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.cssText).toBe('');
  });

  it('keeps safe-area padding outside the fixed-height content row', () => {
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );

    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.className).toContain('shrink-0');
    expect(outer.className).not.toMatch(/\bh-8\b/);

    const inner = outer.firstElementChild as HTMLElement;
    expect(inner.className).toMatch(/\bh-8\b/);
    expect(inner.className).toContain('min-h-[32px]');
  });
});
