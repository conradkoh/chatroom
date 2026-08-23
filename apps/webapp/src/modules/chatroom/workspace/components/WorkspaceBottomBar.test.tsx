import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceBottomBarShell,
  getWorkspaceBottomBarShellStyle,
  shouldSuppressWorkspaceBottomBarSafeArea,
} from './WorkspaceBottomBar';

const mockUseIsDesktop = vi.fn();
const mockUseKeyboardInset = vi.fn();
const mockUseMainChatComposerFocused = vi.fn();

function serializeShellHierarchy(outer: HTMLElement) {
  const inner = outer.querySelector('[data-testid="workspace-bottom-bar-content"]') as HTMLElement | null;
  return {
    outer: {
      testId: outer.getAttribute('data-testid'), className: outer.className,
      paddingBottom: outer.style.paddingBottom, paddingLeft: outer.style.paddingLeft,
      paddingRight: outer.style.paddingRight, transform: outer.style.transform,
    },
    inner: inner ? { testId: inner.getAttribute('data-testid'), className: inner.className } : null,
  };
}

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => mockUseIsDesktop() }));
vi.mock('@/hooks/useMobileKeyboard', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest's importOriginal requires module type
  const actual = await importOriginal<typeof import('@/hooks/useMobileKeyboard')>();
  return {
    ...actual,
    useMainChatComposerKeyboardInset: (enabled?: boolean) =>
      enabled && mockUseMainChatComposerFocused() ? mockUseKeyboardInset() : 0,
    useMainChatComposerFocused: (enabled?: boolean) => enabled ? mockUseMainChatComposerFocused() : false,
  };
});

describe('WorkspaceBottomBarShell', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
    mockUseKeyboardInset.mockReturnValue(0);
    mockUseMainChatComposerFocused.mockReturnValue(false);
  });

  const renderShell = () =>
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );

  it('uses opaque primary background instead of translucent surface', () => {
    renderShell();
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.className).toContain('bg-chatroom-bg-primary');
    expect(outer.className).not.toContain('bg-chatroom-bg-surface');
  });

  it('adds horizontal and bottom safe-area padding on mobile', () => {
    renderShell();
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer).toBeInTheDocument();
    expect(mockUseMainChatComposerFocused).toHaveBeenCalled();
  });

  it('does not lift when inset is present but composer not focused', () => {
    mockUseKeyboardInset.mockReturnValue(300);
    vi.useFakeTimers();
    renderShell();
    vi.advanceTimersByTime(300);
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.paddingBottom).toBe('');
    expect(outer.style.transform).toBe('');
    vi.useRealTimers();
  });

  it('suppresses bottom safe-area when editable element is focused (iOS fallback)', () => {
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderShell();
    expect(screen.getByTestId('workspace-bottom-bar').style.paddingBottom).toBe('');
  });

  it('keeps bottom safe-area when keyboard closed', () => {
    renderShell();
    expect(mockUseKeyboardInset).toHaveBeenCalled();
    expect(mockUseMainChatComposerFocused).toHaveBeenCalled();
  });

  it('does not suppress safe-area on desktop', () => {
    mockUseIsDesktop.mockReturnValue(true);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderShell();
    expect(screen.getByTestId('workspace-bottom-bar').style.cssText).toBe('');
  });

  it('keeps safe-area padding outside the fixed-height content row', () => {
    renderShell();
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.className).toContain('shrink-0');
    expect(outer.className).not.toMatch(/\bh-8\b/);
    const inner = outer.firstElementChild as HTMLElement;
    expect(inner.className).toMatch(/\bh-8\b/);
    expect(inner.className).toContain('min-h-[32px]');
  });

  it('gates safe-area suppression by composer focus and settled threshold', () => {
    expect(shouldSuppressWorkspaceBottomBarSafeArea(0, true)).toBe(true);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(119, false)).toBe(false);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(120, false)).toBe(true);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, false, false)).toBe(false);
  });

  it('composes mobile shell safe-area and keyboard transform styles', () => {
    expect(getWorkspaceBottomBarShellStyle(true, 300, true).transform).toBe('translateY(-300px)');
    expect(getWorkspaceBottomBarShellStyle(false, 300, true).transform).toBe('translateY(-300px)');
  });

  it('lifts footer when composer focused with keyboard inset', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderShell();
    vi.advanceTimersByTime(300);
    expect(screen.getByTestId('workspace-bottom-bar').style.transform).toBe('translateY(-300px)');
    vi.useRealTimers();
  });
});

describe('runtime hierarchy snapshots', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
    mockUseKeyboardInset.mockReturnValue(0);
    mockUseMainChatComposerFocused.mockReturnValue(false);
  });
  const renderSnapshot = () => render(<WorkspaceBottomBarShell><span>content</span></WorkspaceBottomBarShell>);
  const snapshot = () => serializeShellHierarchy(screen.getByTestId('workspace-bottom-bar'));
  it('mobile — keyboard closed', () => { vi.useFakeTimers(); renderSnapshot(); vi.advanceTimersByTime(300); expect(snapshot()).toMatchInlineSnapshot(`
    {
      "inner": {
        "className": "flex items-center h-8 min-h-[32px] px-2",
        "testId": "workspace-bottom-bar-content",
      },
      "outer": {
        "className": "shrink-0 border-t-2 border-chatroom-border-strong bg-chatroom-bg-primary select-none",
        "paddingBottom": "",
        "paddingLeft": "",
        "paddingRight": "",
        "testId": "workspace-bottom-bar",
        "transform": "",
      },
    }
  `); vi.useRealTimers(); });
  it('mobile — keyboard open, composer focused (lifted)', () => { vi.useFakeTimers(); mockUseKeyboardInset.mockReturnValue(300); mockUseMainChatComposerFocused.mockReturnValue(true); renderSnapshot(); vi.advanceTimersByTime(300); expect(screen.getByTestId('workspace-bottom-bar').style.transform).toContain('translateY(-300px)'); expect(snapshot()).toMatchInlineSnapshot(`
    {
      "inner": {
        "className": "flex items-center h-8 min-h-[32px] px-2",
        "testId": "workspace-bottom-bar-content",
      },
      "outer": {
        "className": "shrink-0 border-t-2 border-chatroom-border-strong bg-chatroom-bg-primary select-none",
        "paddingBottom": "",
        "paddingLeft": "",
        "paddingRight": "",
        "testId": "workspace-bottom-bar",
        "transform": "translateY(-300px)",
      },
    }
  `); vi.useRealTimers(); });
  it('mobile — keyboard open, composer NOT focused (no lift)', () => { vi.useFakeTimers(); mockUseKeyboardInset.mockReturnValue(300); renderSnapshot(); vi.advanceTimersByTime(300); expect(screen.getByTestId('workspace-bottom-bar').style.transform).toBe(''); expect(snapshot()).toMatchInlineSnapshot(`
    {
      "inner": {
        "className": "flex items-center h-8 min-h-[32px] px-2",
        "testId": "workspace-bottom-bar-content",
      },
      "outer": {
        "className": "shrink-0 border-t-2 border-chatroom-border-strong bg-chatroom-bg-primary select-none",
        "paddingBottom": "",
        "paddingLeft": "",
        "paddingRight": "",
        "testId": "workspace-bottom-bar",
        "transform": "",
      },
    }
  `); vi.useRealTimers(); });
  it('mobile — composer focused, no inset (iOS fallback)', () => { vi.useFakeTimers(); mockUseMainChatComposerFocused.mockReturnValue(true); renderSnapshot(); vi.advanceTimersByTime(300); expect(screen.getByTestId('workspace-bottom-bar').style.transform).toBe(''); expect(snapshot()).toMatchInlineSnapshot(`
    {
      "inner": {
        "className": "flex items-center h-8 min-h-[32px] px-2",
        "testId": "workspace-bottom-bar-content",
      },
      "outer": {
        "className": "shrink-0 border-t-2 border-chatroom-border-strong bg-chatroom-bg-primary select-none",
        "paddingBottom": "",
        "paddingLeft": "",
        "paddingRight": "",
        "testId": "workspace-bottom-bar",
        "transform": "",
      },
    }
  `); vi.useRealTimers(); });
  it('desktop — unchanged', () => { vi.useFakeTimers(); mockUseIsDesktop.mockReturnValue(true); mockUseKeyboardInset.mockReturnValue(300); mockUseMainChatComposerFocused.mockReturnValue(true); renderSnapshot(); vi.advanceTimersByTime(300); expect(screen.getByTestId('workspace-bottom-bar').style.cssText).toBe(''); expect(snapshot()).toMatchInlineSnapshot(`
    {
      "inner": {
        "className": "flex items-center h-8 min-h-[32px] px-2",
        "testId": "workspace-bottom-bar-content",
      },
      "outer": {
        "className": "shrink-0 border-t-2 border-chatroom-border-strong bg-chatroom-bg-primary select-none",
        "paddingBottom": "",
        "paddingLeft": "",
        "paddingRight": "",
        "testId": "workspace-bottom-bar",
        "transform": "",
      },
    }
  `); vi.useRealTimers(); });
});
