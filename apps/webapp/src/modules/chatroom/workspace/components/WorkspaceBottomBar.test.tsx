import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceBottomBarShell,
  getWorkspaceBottomBarPaddingBottom,
  shouldSuppressWorkspaceBottomBarSafeArea,
  WORKSPACE_BOTTOM_BAR_KEYBOARD_SUPPRESS_THRESHOLD_PX,
} from './WorkspaceBottomBar';

const mockUseIsDesktop = vi.fn();
const mockUseKeyboardInset = vi.fn();
const mockUseEditableFocused = vi.fn();

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('@/hooks/useMobileKeyboard', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    useVisualViewportKeyboardInset: (enabled?: boolean) => (enabled ? mockUseKeyboardInset() : 0),
    useEditableElementFocused: (enabled?: boolean) => (enabled ? mockUseEditableFocused() : false),
  };
});

describe('getWorkspaceBottomBarPaddingBottom', () => {
  it('returns safe-area env when not suppressed', () => {
    expect(getWorkspaceBottomBarPaddingBottom(false)).toBe('env(safe-area-inset-bottom, 0px)');
  });

  it('returns 0 when suppressed', () => {
    expect(getWorkspaceBottomBarPaddingBottom(true)).toBe(0);
  });
});

describe('shouldSuppressWorkspaceBottomBarSafeArea', () => {
  it('does not suppress for small browser-chrome inset', () => {
    expect(shouldSuppressWorkspaceBottomBarSafeArea(34, false)).toBe(false);
  });

  it('suppresses at keyboard threshold', () => {
    expect(
      shouldSuppressWorkspaceBottomBarSafeArea(
        WORKSPACE_BOTTOM_BAR_KEYBOARD_SUPPRESS_THRESHOLD_PX,
        false
      )
    ).toBe(true);
  });

  it('suppresses when editable focused regardless of inset', () => {
    expect(shouldSuppressWorkspaceBottomBarSafeArea(0, true)).toBe(true);
  });
});

describe('WorkspaceBottomBarShell', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
    mockUseKeyboardInset.mockReturnValue(0);
    mockUseEditableFocused.mockReturnValue(false);
  });

  it('reserves safe-area padding outside a fixed-height content row', () => {
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );

    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.className).toContain('shrink-0');
    expect(outer.className).not.toMatch(/\bh-8\b/);

    const inner = outer.firstElementChild as HTMLElement;
    expect(inner).toBeTruthy();
    expect(inner.className).toMatch(/\bh-8\b/);
    expect(inner.className).toContain('min-h-[32px]');
  });

  it('suppresses safe-area when keyboard inset is non-zero', () => {
    mockUseKeyboardInset.mockReturnValue(300);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.paddingBottom).toBe('0px');
    expect(outer.className).not.toContain('pb-[env(safe-area-inset-bottom,0px)]');
  });

  it('suppresses safe-area when editable element is focused (iOS fallback)', () => {
    mockUseEditableFocused.mockReturnValue(true);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.paddingBottom).toBe('0px');
    expect(outer.className).not.toContain('pb-[env(safe-area-inset-bottom,0px)]');
  });

  it('keeps safe-area on desktop', () => {
    mockUseIsDesktop.mockReturnValue(true);
    mockUseEditableFocused.mockReturnValue(true);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.className).toContain('pb-[env(safe-area-inset-bottom,0px)]');
    expect(outer.style.paddingBottom).not.toBe('0px');
  });

  it('keeps safe-area for small visualViewport inset (browser chrome)', () => {
    mockUseKeyboardInset.mockReturnValue(34);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.className).toContain('pb-[env(safe-area-inset-bottom,0px)]');
    expect(outer.style.paddingBottom).not.toBe('0px');
  });
});
