import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceBottomBarShell,
  getWorkspaceBottomBarPaddingBottom,
  shouldSuppressWorkspaceBottomBarSafeArea,
  WORKSPACE_BOTTOM_BAR_KEYBOARD_INSET_SETTLE_MS,
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

  it('suppresses at keyboard threshold when settled', () => {
    expect(
      shouldSuppressWorkspaceBottomBarSafeArea(
        WORKSPACE_BOTTOM_BAR_KEYBOARD_SUPPRESS_THRESHOLD_PX,
        false,
        true
      )
    ).toBe(true);
  });

  it('suppresses when editable focused regardless of inset', () => {
    expect(shouldSuppressWorkspaceBottomBarSafeArea(0, true)).toBe(true);
  });

  it('does not suppress large inset until settled', () => {
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, false, false)).toBe(false);
  });

  it('suppresses large inset once settled', () => {
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, false, true)).toBe(true);
  });

  it('suppresses on editable focus even when unsettled', () => {
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, true, false)).toBe(true);
  });
});

describe('WorkspaceBottomBarShell', () => {
  beforeEach(() => {
    vi.useRealTimers();
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
    // Inline style has env (JSDOM can't resolve env(), so computed value is empty, not '0px')
    expect(outer.style.paddingBottom).toBe('');

    const inner = outer.firstElementChild as HTMLElement;
    expect(inner).toBeTruthy();
    expect(inner.className).toMatch(/\bh-8\b/);
    expect(inner.className).toContain('min-h-[32px]');
  });

  it('suppresses safe-area when keyboard inset is non-zero', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    act(() => {
      vi.advanceTimersByTime(WORKSPACE_BOTTOM_BAR_KEYBOARD_INSET_SETTLE_MS);
    });
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.paddingBottom).toBe('0px');
    vi.useRealTimers();
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
  });

  it('keeps safe-area on desktop even when editable focused', () => {
    mockUseIsDesktop.mockReturnValue(true);
    mockUseEditableFocused.mockReturnValue(true);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    const outer = screen.getByTestId('workspace-bottom-bar');
    // JSDOM can't resolve env(), so computed style is empty (not '0px')
    expect(outer.style.paddingBottom).toBe('');
  });

  it('keeps safe-area for small visualViewport inset (browser chrome)', () => {
    mockUseKeyboardInset.mockReturnValue(34);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    const outer = screen.getByTestId('workspace-bottom-bar');
    // JSDOM can't resolve env(), so computed style is empty (not '0px')
    expect(outer.style.paddingBottom).toBe('');
  });

  describe('inset settle', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not suppress large inset until settle timeout elapses', () => {
      mockUseKeyboardInset.mockReturnValue(300);
      render(
        <WorkspaceBottomBarShell>
          <span>content</span>
        </WorkspaceBottomBarShell>
      );

      const outer = screen.getByTestId('workspace-bottom-bar');
      // Before settle: not suppressed (JSDOM returns empty for env())
      expect(outer.style.paddingBottom).toBe('');

      // Advance past settle timeout
      act(() => {
        vi.advanceTimersByTime(WORKSPACE_BOTTOM_BAR_KEYBOARD_INSET_SETTLE_MS);
      });

      // After settle: suppressed (0px)
      expect(outer.style.paddingBottom).toBe('0px');
    });

    it('suppresses immediately when editable focused before settle', () => {
      mockUseKeyboardInset.mockReturnValue(300);
      mockUseEditableFocused.mockReturnValue(true);
      render(
        <WorkspaceBottomBarShell>
          <span>content</span>
        </WorkspaceBottomBarShell>
      );

      const outer = screen.getByTestId('workspace-bottom-bar');
      // editableFocused takes effect immediately even before settle
      expect(outer.style.paddingBottom).toBe('0px');
    });
  });
});
