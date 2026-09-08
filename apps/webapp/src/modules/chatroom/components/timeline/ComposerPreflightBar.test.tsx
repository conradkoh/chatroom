import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposerPreflightBar } from './ComposerPreflightBar';

const { mockNewSessionToggle, mockModeToggle } = vi.hoisted(() => ({
  mockNewSessionToggle: vi.fn(),
  mockModeToggle: vi.fn(),
}));

vi.mock('../../features/enhancers/components/PlannerNewSessionToggle', () => ({
  PlannerNewSessionToggle: (props: unknown) => {
    mockNewSessionToggle(props);
    return <div data-testid="planner-new-session-toggle" />;
  },
}));
vi.mock('../../features/enhancers/components/PlannerConversationModeToggle', () => ({
  PlannerConversationModeToggle: (props: unknown) => {
    mockModeToggle(props);
    return <div data-testid="planner-conversation-mode-toggle" />;
  },
}));
vi.mock('../StandingInstructionsBar', () => ({
  StandingInstructionsBar: () => <div data-testid="standing-instructions-bar" />,
}));
vi.mock('../../hooks/useAgentPanelData', () => ({
  useAgentPanelData: () => ({ teamId: 'duo', teamRoles: ['planner', 'builder'], isLoading: false }),
}));
vi.mock('../../hooks/useChatroomLifecycle', () => ({
  useChatroomLifecycle: () => ({ activeWorkspace: { machineId: 'm1' } }),
}));

describe('ComposerPreflightBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses compact icon-only columns below sm and labeled min-width at sm+', () => {
    render(<ComposerPreflightBar chatroomId={'room1' as never} />);
    const bar = screen.getByTestId('composer-preflight-bar');
    const toggleColumns = bar.querySelectorAll(':scope > div:not(:first-child)');

    expect(toggleColumns).toHaveLength(2);
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

  it('renders the conversation mode toggle', () => {
    render(<ComposerPreflightBar chatroomId={'room1' as never} />);
    expect(screen.getByTestId('planner-conversation-mode-toggle')).toBeInTheDocument();
  });

  it('forwards onRequestComposerFocus to both toggles', () => {
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
    expect(mockModeToggle).toHaveBeenCalledWith(
      expect.objectContaining({ onRequestComposerFocus })
    );
  });
});
