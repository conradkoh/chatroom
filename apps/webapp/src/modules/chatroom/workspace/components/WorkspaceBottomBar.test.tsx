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
const mockUseMainChatComposerFocused = vi.fn();

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => mockUseIsDesktop(),
}));

vi.mock('@/hooks/useMobileKeyboard', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    useMainChatComposerKeyboardInset: (enabled?: boolean) => {
      if (!enabled) return 0;
      // Mirrors production: composer-gated — inset only reaches the footer when focused.
      return mockUseMainChatComposerFocused() ? mockUseKeyboardInset() : 0;
    },
    useMainChatComposerFocused: (enabled?: boolean) =>
      enabled ? mockUseMainChatComposerFocused() : false,
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
    mockUseMainChatComposerFocused.mockReturnValue(false);
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

  it('does not lift the footer when keyboard inset is non-zero but main composer is not focused', () => {
    mockUseKeyboardInset.mockReturnValue(300);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.transform).toBe('');
    expect(outer.style.paddingBottom).toBe('');
  });

  it('lifts the footer and suppresses safe-area when main composer is focused with keyboard inset', () => {
    mockUseKeyboardInset.mockReturnValue(300);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.transform).toContain('translateY');
    expect(outer.style.paddingBottom).toBe('0px');
  });

  it('suppresses safe-area when main composer is focused (iOS fallback)', () => {
    mockUseMainChatComposerFocused.mockReturnValue(true);
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.paddingBottom).toBe('0px');
  });

  it('keeps safe-area on desktop even when main composer is focused', () => {
    mockUseIsDesktop.mockReturnValue(true);
    mockUseMainChatComposerFocused.mockReturnValue(true);
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

  describe('main composer focus', () => {
    it('suppresses safe-area immediately when main composer is focused even before settle', () => {
      mockUseKeyboardInset.mockReturnValue(300);
      mockUseMainChatComposerFocused.mockReturnValue(true);
      render(
        <WorkspaceBottomBarShell>
          <span>content</span>
        </WorkspaceBottomBarShell>
      );

      const outer = screen.getByTestId('workspace-bottom-bar');
      // composer focus suppresses right away — no 300ms settle wait needed
      expect(outer.style.paddingBottom).toBe('0px');
    });
  });
});
