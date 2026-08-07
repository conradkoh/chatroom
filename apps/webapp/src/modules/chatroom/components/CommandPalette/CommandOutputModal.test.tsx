import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandOutputModal, OPEN_GRACE_MS } from './CommandOutputModal';

import type { CommandPaletteOutputState } from '@/modules/chatroom/hooks/useCommandRunOutputV2';

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: vi.fn(() => true),
}));

vi.mock('@/hooks/useMobileKeyboard', () => ({
  useVisualViewportOffsetTop: vi.fn(() => 0),
}));

vi.mock('./CommandOutputPanel', () => ({
  CommandOutputPanel: () => <div data-testid="output-panel">output</div>,
}));

function makeInlineCommand(): CommandPaletteOutputState {
  return {
    commandName: 'my-cmd',
    script: 'echo hi',
    isRunning: true,
    status: 'running',
    terminationReason: null,
    output: [],
    run: vi.fn(),
    stop: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
    close: vi.fn(),
    loadMore: vi.fn(async () => {}),
    canLoadMore: false,
    fullOutputPending: false,
  };
}

function focusOutside(): HTMLElement {
  const outside = document.createElement('button');
  document.body.appendChild(outside);
  return outside;
}

describe('CommandOutputModal open-grace guard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders dialog content when commandName is set', () => {
    const inlineCommand = makeInlineCommand();
    render(<CommandOutputModal inlineCommand={inlineCommand} />);
    expect(document.querySelector('[data-slot="command-dialog-dismiss-backdrop"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="output-panel"]')).not.toBeNull();
  });

  it('does not dismiss on pointerdown outside within grace', () => {
    const inlineCommand = makeInlineCommand();
    render(<CommandOutputModal inlineCommand={inlineCommand} />);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(inlineCommand.detach).not.toHaveBeenCalled();
  });

  it('does not dismiss on focus-outside within grace', () => {
    const inlineCommand = makeInlineCommand();
    render(<CommandOutputModal inlineCommand={inlineCommand} />);

    const outside = focusOutside();
    outside.focus();

    expect(inlineCommand.detach).not.toHaveBeenCalled();
  });

  it('dismisses on focus-outside after grace period elapses', () => {
    const inlineCommand = makeInlineCommand();
    render(<CommandOutputModal inlineCommand={inlineCommand} />);

    vi.advanceTimersByTime(OPEN_GRACE_MS + 100);

    const outside = focusOutside();
    outside.focus();

    expect(inlineCommand.detach).toHaveBeenCalledTimes(1);
  });
});
