import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommandOutputModal } from './CommandOutputModal';

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

describe('CommandOutputModal', () => {
  it('renders dialog content when commandName is set', () => {
    const inlineCommand = makeInlineCommand();
    render(<CommandOutputModal inlineCommand={inlineCommand} />);
    expect(document.querySelector('[data-slot="command-dialog-dismiss-backdrop"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="output-panel"]')).not.toBeNull();
  });

  it('dismisses from the command dialog backdrop', () => {
    const inlineCommand = makeInlineCommand();
    render(<CommandOutputModal inlineCommand={inlineCommand} />);

    const backdrop = document.querySelector<HTMLElement>(
      '[data-slot="command-dialog-dismiss-backdrop"]'
    );
    backdrop?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));

    expect(inlineCommand.detach).toHaveBeenCalledTimes(1);
  });

  it('does not dismiss on pointerdown outside the backdrop', () => {
    const inlineCommand = makeInlineCommand();
    render(<CommandOutputModal inlineCommand={inlineCommand} />);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect(inlineCommand.detach).not.toHaveBeenCalled();
  });
});
