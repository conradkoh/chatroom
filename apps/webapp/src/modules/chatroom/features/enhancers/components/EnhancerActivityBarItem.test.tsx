import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EnhancerActivityBarItem } from './EnhancerActivityBarItem';

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => undefined,
  useSessionMutation: () => vi.fn(),
}));

vi.mock('@/hooks/useMachineModels', () => ({
  useMachineModels: () => ({ availableModels: {}, isLoading: false }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    web: {
      enhancer: {
        index: {
          getConfig: 'enhancer:getConfig',
          upsertConfig: 'enhancer:upsertConfig',
          disableConfig: 'enhancer:disableConfig',
          getActiveJob: 'enhancer:getActiveJob',
          cancelActiveJob: 'enhancer:cancelActiveJob',
        },
      },
    },
    machines: {
      listMachines: 'machines:listMachines',
      getMachineModels: 'machines:getMachineModels',
    },
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
      setMachineConfigFavorites: 'machineConfigFavorites:setMachineConfigFavorites',
    },
    enhancerConfigFavorites: {
      getEnhancerConfigFavorites: 'enhancerConfigFavorites:getEnhancerConfigFavorites',
      setEnhancerConfigFavorites: 'enhancerConfigFavorites:setEnhancerConfigFavorites',
    },
  },
}));

describe('EnhancerActivityBarItem', () => {
  it('renders the sparkles button', () => {
    render(<EnhancerActivityBarItem chatroomId="room-1" machineId={null} />);

    expect(screen.getByTestId('enhancer-activity-bar-item')).toBeInTheDocument();
  });

  it('shows inactive state by default', () => {
    render(<EnhancerActivityBarItem chatroomId="room-1" machineId={null} />);

    const button = screen.getByTestId('enhancer-activity-bar-item');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveAttribute('title', 'Configure enhancer');
  });

  it('opens the config dialog on click', () => {
    render(<EnhancerActivityBarItem chatroomId="room-1" machineId={null} />);

    fireEvent.click(screen.getByTestId('enhancer-activity-bar-item'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
