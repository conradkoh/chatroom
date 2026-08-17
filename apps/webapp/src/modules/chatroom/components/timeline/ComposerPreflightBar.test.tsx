import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ComposerPreflightBar } from './ComposerPreflightBar';

vi.mock('../../features/enhancers/components/PlannerNewSessionToggle', () => ({
  PlannerNewSessionToggle: () => <div data-testid="planner-new-session-toggle" />,
}));
vi.mock('../../features/enhancers/components/PlannerEnhancerToggle', () => ({
  PlannerEnhancerToggle: () => <div data-testid="planner-enhancer-toggle" />,
}));
vi.mock('../StandingInstructionsBar', () => ({
  StandingInstructionsBar: () => <div data-testid="standing-instructions-bar" />,
}));
vi.mock('../../hooks/useAgentPanelData', () => ({
  useAgentPanelData: () => ({ teamRoles: ['planner', 'builder'], isLoading: false }),
}));
vi.mock('../../hooks/useChatroomLifecycle', () => ({
  useChatroomLifecycle: () => ({ activeWorkspace: { machineId: 'm1' } }),
}));

describe('ComposerPreflightBar', () => {
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
});
