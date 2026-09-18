import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposerPreflightBar } from './ComposerPreflightBar';

const { mockNewSessionToggle } = vi.hoisted(() => ({
  mockNewSessionToggle: vi.fn(),
}));

vi.mock('./PlannerNewSessionToggle', () => ({
  PlannerNewSessionToggle: (props: unknown) => {
    mockNewSessionToggle(props);
    return <div data-testid="planner-new-session-toggle" />;
  },
}));
vi.mock('../StandingInstructionsBar', () => ({
  StandingInstructionsBar: () => <div data-testid="standing-instructions-bar" />,
}));

describe('ComposerPreflightBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses compact icon-only columns below sm and labeled min-width at sm+', () => {
    render(<ComposerPreflightBar chatroomId={'room1' as never} />);
    const bar = screen.getByTestId('composer-preflight-bar');
    const toggleColumns = bar.querySelectorAll(':scope > div:not(:first-child)');

    expect(toggleColumns).toHaveLength(1);
    for (const column of toggleColumns) {
      expect(column.className).toContain('w-[3.75rem]');
      expect(column.className).toContain('sm:min-w-[7rem]');
    }
  });

  it('gives standing instructions flex-1 min-w-0', () => {
    render(<ComposerPreflightBar chatroomId={'room1' as never} />);
    const siColumn = screen.getByTestId('composer-preflight-bar').firstElementChild;

    expect(siColumn?.className).toContain('flex-1');
    expect(siColumn?.className).toContain('min-w-0');
  });

  it('does not render a conversation mode or enhancer control', () => {
    render(<ComposerPreflightBar chatroomId={'room1' as never} />);
    expect(screen.queryByTestId('planner-conversation-mode-toggle')).not.toBeInTheDocument();
  });

  it('forwards onRequestComposerFocus to the new-session toggle', () => {
    const onRequestComposerFocus = vi.fn();
    render(
      <ComposerPreflightBar
        chatroomId={'room1' as never}
        onRequestComposerFocus={onRequestComposerFocus}
      />
    );

    expect(mockNewSessionToggle).toHaveBeenCalledWith(
      expect.objectContaining({ onRequestComposerFocus })
    );
  });
});
