import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkspaceBottomBar,
  WorkspaceBottomBarShell,
  getWorkspaceBottomBarShellStyle,
  shouldSuppressWorkspaceBottomBarSafeArea,
} from './WorkspaceBottomBar';

const mockUseIsDesktop = vi.fn();
const mockUseKeyboardInset = vi.fn(); // raw visualViewport inset (Android)
const mockUseViewportOffsetTop = vi.fn(); // raw visualViewport offsetTop (iOS)
const mockUseViewportScale = vi.fn(); // visualViewport.scale (pinch-zoom factor)
const mockUseMainChatComposerFocused = vi.fn();
const mockUseChatroomWorkspace = vi.fn();

function serializeShellHierarchy(outer: HTMLElement) {
  const inner = outer.querySelector(
    '[data-testid="workspace-bottom-bar-content"]'
  ) as HTMLElement | null;
  return {
    outer: {
      testId: outer.getAttribute('data-testid'),
      className: outer.className,
      paddingBottom: outer.style.paddingBottom,
      paddingLeft: outer.style.paddingLeft,
      paddingRight: outer.style.paddingRight,
      transform: outer.style.transform,
    },
    inner: inner ? { testId: inner.getAttribute('data-testid'), className: inner.className } : null,
  };
}

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => mockUseIsDesktop() }));
vi.mock('../../features/switch-workspace/SwitchWorkspaceDialog', () => ({
  SwitchWorkspaceDialog: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="switch-dialog-stub">
      <button type="button" onClick={onClose}>
        close-switch
      </button>
    </div>
  ),
}));
vi.mock('../../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => mockUseChatroomWorkspace(),
}));
vi.mock('@/hooks/useDaemonConnected', () => ({
  useDaemonConnected: () => ({ isConnected: true }),
}));
vi.mock('@/hooks/useSendLocalAction', () => ({
  useSendLocalAction: () => vi.fn(),
}));
vi.mock('../hooks/useWorkspaceGit', () => ({
  useWorkspaceGit: () => ({ status: 'loading' }),
  useGitRefresh: () => vi.fn(),
}));
vi.mock('@/hooks/useMobileKeyboard', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest's importOriginal requires module type
  const actual = await importOriginal<typeof import('@/hooks/useMobileKeyboard')>();
  return {
    ...actual,
    useVisualViewportKeyboardInset: (enabled?: boolean) => (enabled ? mockUseKeyboardInset() : 0),
    useVisualViewportOffsetTop: (enabled?: boolean) => (enabled ? mockUseViewportOffsetTop() : 0),
    useVisualViewportScale: (enabled?: boolean) => (enabled ? mockUseViewportScale() : 1),
    useMainChatComposerKeyboardInset: (enabled?: boolean) =>
      enabled && mockUseMainChatComposerFocused() ? mockUseKeyboardInset() : 0,
  };
});

describe('WorkspaceBottomBarShell', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
    mockUseKeyboardInset.mockReturnValue(0);
    mockUseViewportOffsetTop.mockReturnValue(0);
    mockUseViewportScale.mockReturnValue(1);
    mockUseMainChatComposerFocused.mockReturnValue(false);
  });

  const bar = () => screen.getByTestId('workspace-bottom-bar');
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

  it('renders the bar on mobile', () => {
    renderShell();
    expect(bar()).toBeInTheDocument();
  });

  it('keeps bottom inset present when composer is focused and no keyboard is present', () => {
    vi.useFakeTimers();
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(bar().getAttribute('data-bottom-inset')).toBe('present');
    expect(bar().style.transform).toBe('');
    vi.useRealTimers();
  });

  it('suppresses bottom inset and lifts with Android-style visualViewport inset (composer focused)', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(bar().getAttribute('data-bottom-inset')).toBe('suppressed');
    expect(bar().style.transform).toBe('translateY(-300px)');
    vi.useRealTimers();
  });

  it('suppresses bottom inset without lifting with iOS-style offsetTop (composer focused)', () => {
    vi.useFakeTimers();
    mockUseViewportOffsetTop.mockReturnValue(300);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(bar().getAttribute('data-bottom-inset')).toBe('suppressed');
    expect(bar().style.transform).toBe('');
    vi.useRealTimers();
  });

  it('suppresses bottom inset when a keyboard covers the bar but composer is not focused (dialog input)', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(bar().getAttribute('data-bottom-inset')).toBe('suppressed');
    expect(bar().style.transform).toBe('');
    vi.useRealTimers();
  });

  it('restores bottom inset once the keyboard closes', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    const { rerender } = renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(bar().getAttribute('data-bottom-inset')).toBe('suppressed');
    mockUseKeyboardInset.mockReturnValue(0);
    rerender(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
    expect(bar().getAttribute('data-bottom-inset')).toBe('present');
    vi.useRealTimers();
  });

  it('does not suppress before the settle window elapses', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    renderShell();
    expect(bar().getAttribute('data-bottom-inset')).toBe('present');
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(bar().getAttribute('data-bottom-inset')).toBe('suppressed');
    vi.useRealTimers();
  });

  it('desktop: no suppression, no inline shell styles', () => {
    vi.useFakeTimers();
    mockUseIsDesktop.mockReturnValue(true);
    mockUseKeyboardInset.mockReturnValue(300);
    mockUseViewportOffsetTop.mockReturnValue(300);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(bar().getAttribute('data-bottom-inset')).toBe('present');
    expect(bar().style.cssText).toBe('');
    vi.useRealTimers();
  });

  it('adds no CSS transition to the bar', () => {
    renderShell();
    expect(bar().className).not.toMatch(/transition/);
  });

  it('does not lift when inset is present but composer not focused', () => {
    mockUseKeyboardInset.mockReturnValue(300);
    vi.useFakeTimers();
    renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    const outer = screen.getByTestId('workspace-bottom-bar');
    expect(outer.style.paddingBottom).toBe('');
    expect(outer.style.transform).toBe('');
    vi.useRealTimers();
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

  it('composes mobile shell safe-area and keyboard transform styles', () => {
    expect(getWorkspaceBottomBarShellStyle(true, 300, true).transform).toBe('translateY(-300px)');
    expect(getWorkspaceBottomBarShellStyle(false, 300, true).transform).toBe('translateY(-300px)');
  });

  it('keeps env() bottom padding when not suppressed, drops it when suppressed (mobile)', () => {
    expect(getWorkspaceBottomBarShellStyle(true, 0, false).paddingBottom).toBe(
      'env(safe-area-inset-bottom, 0px)'
    );
    expect(getWorkspaceBottomBarShellStyle(true, 0, true).paddingBottom).toBeUndefined();
  });

  it('lifts footer when composer focused with keyboard inset', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(screen.getByTestId('workspace-bottom-bar').style.transform).toBe('translateY(-300px)');
    vi.useRealTimers();
  });

  it('keeps bottom inset present under pinch-zoom with no keyboard', () => {
    vi.useFakeTimers();
    // 800px layout viewport pinched to 2x: visualViewport.height is 400, so the
    // occlusion reads as 400px with no keyboard on screen.
    mockUseKeyboardInset.mockReturnValue(400);
    mockUseViewportScale.mockReturnValue(2);
    renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(bar().getAttribute('data-bottom-inset')).toBe('present');
    expect(bar().style.transform).toBe('');
    vi.useRealTimers();
  });

  it('keeps bottom inset present when a keyboard is up but the view is pinch-zoomed', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    mockUseViewportScale.mockReturnValue(1.5);
    renderShell();
    act(() => vi.advanceTimersByTime(300)); // settle window
    expect(bar().getAttribute('data-bottom-inset')).toBe('present');
    vi.useRealTimers();
  });
});

describe('shouldSuppressWorkspaceBottomBarSafeArea', () => {
  it('suppresses only when settled and keyboard occlusion reaches the 120px threshold', () => {
    expect(shouldSuppressWorkspaceBottomBarSafeArea(0)).toBe(false);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(119)).toBe(false);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(120)).toBe(true);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, false)).toBe(false);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, true)).toBe(true);
  });

  it('does not suppress under pinch-zoom, even with a large occlusion', () => {
    // 800px layout at 2x: visualViewport.height = 400, occlusion = 400 with no keyboard.
    expect(shouldSuppressWorkspaceBottomBarSafeArea(400, true, 2)).toBe(false);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, true, 1.5)).toBe(false);
  });

  it('treats scale up to 1.01 as not zoomed and anything above as zoomed', () => {
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, true, 1)).toBe(true);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, true, 1.01)).toBe(true);
    expect(shouldSuppressWorkspaceBottomBarSafeArea(300, true, 1.02)).toBe(false);
  });
});

describe('WorkspaceBottomBarShell tap guard', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
    mockUseKeyboardInset.mockReturnValue(0);
    mockUseViewportOffsetTop.mockReturnValue(0);
    mockUseViewportScale.mockReturnValue(1);
    mockUseMainChatComposerFocused.mockReturnValue(false);
  });

  const renderWithComposer = (onChildClick: () => void = () => {}) =>
    render(
      <>
        <div data-main-chat-composer>
          <textarea aria-label="composer" />
        </div>
        <input aria-label="dialog input" />
        <WorkspaceBottomBarShell>
          <button type="button" onClick={onChildClick}>
            act
          </button>
        </WorkspaceBottomBarShell>
      </>
    );

  it('prevents default on mousedown when mobile and the main composer is focused', () => {
    renderWithComposer();
    const composer = screen.getByLabelText('composer');
    composer.focus();
    const notPrevented = fireEvent.mouseDown(screen.getByTestId('workspace-bottom-bar'));
    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(composer);
  });

  it('does not prevent mousedown when focus is outside the main composer', () => {
    renderWithComposer();
    screen.getByLabelText('dialog input').focus();
    expect(fireEvent.mouseDown(screen.getByTestId('workspace-bottom-bar'))).toBe(true);
  });

  it('does not prevent mousedown on desktop', () => {
    mockUseIsDesktop.mockReturnValue(true);
    renderWithComposer();
    screen.getByLabelText('composer').focus();
    expect(fireEvent.mouseDown(screen.getByTestId('workspace-bottom-bar'))).toBe(true);
  });

  it('child button still receives click after a guarded mousedown', () => {
    const onChildClick = vi.fn();
    renderWithComposer(onChildClick);
    screen.getByLabelText('composer').focus();
    const button = screen.getByRole('button', { name: 'act' });
    fireEvent.mouseDown(button);
    fireEvent.click(button);
    expect(onChildClick).toHaveBeenCalledTimes(1);
  });
});

describe('runtime hierarchy snapshots', () => {
  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
    mockUseKeyboardInset.mockReturnValue(0);
    mockUseViewportOffsetTop.mockReturnValue(0);
    mockUseViewportScale.mockReturnValue(1);
    mockUseMainChatComposerFocused.mockReturnValue(false);
  });
  const renderSnapshot = () =>
    render(
      <WorkspaceBottomBarShell>
        <span>content</span>
      </WorkspaceBottomBarShell>
    );
  const snapshot = () => serializeShellHierarchy(screen.getByTestId('workspace-bottom-bar'));
  it('mobile — keyboard closed', () => {
    vi.useFakeTimers();
    renderSnapshot();
    act(() => vi.advanceTimersByTime(300));
    expect(snapshot()).toMatchInlineSnapshot(`
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
  `);
    vi.useRealTimers();
  });
  it('mobile — keyboard open, composer focused (lifted)', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderSnapshot();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('workspace-bottom-bar').style.transform).toContain(
      'translateY(-300px)'
    );
    expect(snapshot()).toMatchInlineSnapshot(`
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
  `);
    vi.useRealTimers();
  });
  it('mobile — keyboard open, composer NOT focused (no lift)', () => {
    vi.useFakeTimers();
    mockUseKeyboardInset.mockReturnValue(300);
    renderSnapshot();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('workspace-bottom-bar').style.transform).toBe('');
    expect(snapshot()).toMatchInlineSnapshot(`
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
  `);
    vi.useRealTimers();
  });
  it('mobile — composer focused, no inset (iOS fallback)', () => {
    vi.useFakeTimers();
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderSnapshot();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('workspace-bottom-bar').style.transform).toBe('');
    expect(snapshot()).toMatchInlineSnapshot(`
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
  `);
    vi.useRealTimers();
  });
  it('desktop — unchanged', () => {
    vi.useFakeTimers();
    mockUseIsDesktop.mockReturnValue(true);
    mockUseKeyboardInset.mockReturnValue(300);
    mockUseMainChatComposerFocused.mockReturnValue(true);
    renderSnapshot();
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByTestId('workspace-bottom-bar').style.cssText).toBe('');
    expect(snapshot()).toMatchInlineSnapshot(`
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
  `);
    vi.useRealTimers();
  });
});

describe('WorkspaceBottomBar workspace-path copy', () => {
  const workspace = {
    id: 'machine-1::/Users/alice/repo',
    machineId: 'machine-1',
    hostname: 'host-a',
    workingDir: '/Users/alice/repo',
    agentRoles: [],
    fileTreeSyncEnabled: true,
  };

  beforeEach(() => {
    mockUseIsDesktop.mockReturnValue(false);
    mockUseKeyboardInset.mockReturnValue(0);
    mockUseViewportOffsetTop.mockReturnValue(0);
    mockUseViewportScale.mockReturnValue(1);
    mockUseMainChatComposerFocused.mockReturnValue(false);
    mockUseChatroomWorkspace.mockReturnValue({
      chatroomId: 'chatroom-1',
      workspaces: [workspace],
      activeWorkspace: workspace,
      isLoading: false,
      setPrimaryWorkspace: vi.fn().mockResolvedValue(undefined),
      removeWorkspace: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('reports a rejected workspace-path copy from the mobile modal', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const onCopied = vi.fn();
    const onCopyError = vi.fn();

    render(<WorkspaceBottomBar onCopied={onCopied} onCopyError={onCopyError} />);

    fireEvent.click(screen.getByTitle('View workspace details'));
    fireEvent.click(await screen.findByRole('button', { name: /host-a/i }));
    fireEvent.click(await screen.findByText('Copy workspace path'));

    await vi.waitFor(() => {
      expect(onCopyError).toHaveBeenCalledTimes(1);
    });
    expect(onCopyError).toHaveBeenCalledWith('Failed to copy to clipboard');
    expect(onCopied).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith('/Users/alice/repo');
  });
});

describe('WorkspaceBottomBar switch-workspace entry points', () => {
  const workspace = {
    id: 'm1::/code/app',
    machineId: 'm1',
    hostname: 'host-a',
    workingDir: '/code/app',
    agentRoles: [],
    fileTreeSyncEnabled: true,
  };

  beforeEach(() => {
    mockUseKeyboardInset.mockReturnValue(0);
    mockUseViewportOffsetTop.mockReturnValue(0);
    mockUseViewportScale.mockReturnValue(1);
    mockUseMainChatComposerFocused.mockReturnValue(false);
    mockUseChatroomWorkspace.mockReturnValue({
      chatroomId: 'chatroom-1',
      workspaces: [workspace],
      activeWorkspace: workspace,
      isLoading: false,
      setPrimaryWorkspace: vi.fn().mockResolvedValue(undefined),
      removeWorkspace: vi.fn().mockResolvedValue(undefined),
      switchWorkspace: vi.fn(),
    });
  });

  it('opens the switch dialog from the desktop picker', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(true);
    render(<WorkspaceBottomBar />);

    await user.click(screen.getByTitle('/code/app'));
    await user.click(await screen.findByTestId('switch-workspace-action'));

    expect(screen.getByTestId('switch-dialog-stub')).toBeInTheDocument();
  });

  it('restores focus to the desktop picker trigger on close', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(true);
    render(<WorkspaceBottomBar />);

    const trigger = screen.getByTitle('/code/app');
    await user.click(trigger);
    await user.click(await screen.findByTestId('switch-workspace-action'));
    await user.click(screen.getByRole('button', { name: 'close-switch' }));

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('opens the switch dialog from the mobile modal row', async () => {
    mockUseIsDesktop.mockReturnValue(false);
    render(<WorkspaceBottomBar />);

    fireEvent.click(screen.getByTitle('View workspace details'));
    expect(await screen.findByText('Workspace')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('switch-workspace-action-mobile'));

    expect(screen.getByTestId('switch-dialog-stub')).toBeInTheDocument();
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('disables both entry points while the context is loading', async () => {
    const user = userEvent.setup();
    mockUseIsDesktop.mockReturnValue(true);
    mockUseChatroomWorkspace.mockReturnValue({
      chatroomId: 'chatroom-1',
      workspaces: [workspace],
      activeWorkspace: workspace,
      isLoading: true,
      setPrimaryWorkspace: vi.fn().mockResolvedValue(undefined),
      removeWorkspace: vi.fn().mockResolvedValue(undefined),
      switchWorkspace: vi.fn(),
    });
    const { unmount } = render(<WorkspaceBottomBar />);

    await user.click(screen.getByTitle('/code/app'));
    expect(await screen.findByTestId('switch-workspace-action')).toHaveAttribute(
      'aria-disabled',
      'true'
    );

    unmount();

    mockUseIsDesktop.mockReturnValue(false);
    render(<WorkspaceBottomBar />);
    fireEvent.click(screen.getByTitle('View workspace details'));

    expect(await screen.findByTestId('switch-workspace-action-mobile')).toBeDisabled();
  });
});
