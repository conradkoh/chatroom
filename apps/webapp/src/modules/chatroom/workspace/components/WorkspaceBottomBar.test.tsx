import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WorkspaceBottomBarShell } from './WorkspaceBottomBar';

const mockUseIsDesktop = vi.fn();
const mockUseKeyboardInset = vi.fn();
const mockUseEditableFocused = vi.fn();

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => mockUseIsDesktop() }));
vi.mock('@/hooks/useMobileKeyboard', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest's importOriginal requires module type
  const actual = await importOriginal<typeof import('@/hooks/useMobileKeyboard')>();
  return {
    ...actual,
    useVisualViewportKeyboardInset: (enabled?: boolean) => (enabled ? mockUseKeyboardInset() : 0),
    useEditableElementFocused: (enabled?: boolean) => (enabled ? mockUseEditableFocused() : false),
  };
});

describe('WorkspaceBottomBarShell', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
    mockUseKeyboardInset.mockReturnValue(0);
    mockUseEditableFocused.mockReturnValue(false);
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
    expect(mockUseKeyboardInset).toHaveBeenCalled();
    expect(mockUseEditableFocused).toHaveBeenCalled();
  });

  it('suppresses bottom safe-area when keyboard inset is non-zero', () => {
    mockUseKeyboardInset.mockReturnValue(300);
    renderShell();
    expect(screen.getByTestId('workspace-bottom-bar').style.paddingBottom).toBe('');
  });

  it('suppresses bottom safe-area when editable element is focused (iOS fallback)', () => {
    mockUseEditableFocused.mockReturnValue(true);
    renderShell();
    expect(screen.getByTestId('workspace-bottom-bar').style.paddingBottom).toBe('');
  });

  it('keeps bottom safe-area when keyboard closed', () => {
    renderShell();
    expect(mockUseKeyboardInset).toHaveBeenCalled();
    expect(mockUseEditableFocused).toHaveBeenCalled();
  });

  it('does not suppress safe-area on desktop', () => {
    mockUseIsDesktop.mockReturnValue(true);
    mockUseEditableFocused.mockReturnValue(true);
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
});
