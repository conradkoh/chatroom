import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { EnhancerConfigDialog } from './EnhancerConfigDialog';
import type { EnhancerConfig } from '../types/enhancer';

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => [],
}));

vi.mock('@/hooks/useMachineModels', () => ({
  useMachineModels: () => ({ availableModels: {}, isLoading: false }),
}));

const CHATROOM_ID = 'room-1';

function makeConfig(overrides?: Partial<EnhancerConfig>): EnhancerConfig {
  return {
    enabled: true,
    targetId: 'handoff:planner-to-builder',
    agentHarness: 'opencode',
    model: 'anthropic/claude-opus-4',
    ...overrides,
  };
}

describe('EnhancerConfigDialog', () => {
  const onConfirm = vi.fn();
  const onDisable = vi.fn();
  const onOpenChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the target section', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId={null}
        initialConfig={null}
        onConfirm={onConfirm}
        onDisable={onDisable}
      />
    );

    expect(screen.getByText('Enhancer configuration')).toBeDefined();
    expect(screen.getByText('Handoff: Planner → Builder')).toBeDefined();
  });

  it('shows helper text when no machineId provided', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId={null}
        initialConfig={null}
        onConfirm={onConfirm}
        onDisable={onDisable}
      />
    );

    expect(
      screen.getByText('Select a workspace with a connected machine to choose a model.')
    ).toBeDefined();
  });

  it('calls onConfirm with config when Enable clicked with selections', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId={null}
        initialConfig={null}
        onConfirm={onConfirm}
        onDisable={onDisable}
      />
    );

    const targetButton = screen.getByText('Handoff: Planner → Builder');
    fireEvent.click(targetButton);

    const enableButton = screen.getByText('Enable');
    expect(enableButton.hasAttribute('disabled')).toBe(true);
  });

  it('shows Disable button when initial config is active', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId={null}
        initialConfig={makeConfig()}
        onConfirm={onConfirm}
        onDisable={onDisable}
      />
    );

    const disableButton = screen.getByText('Disable');
    fireEvent.click(disableButton);

    expect(onDisable).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange(false) on Cancel', () => {
    render(
      <EnhancerConfigDialog
        open={true}
        onOpenChange={onOpenChange}
        chatroomId={CHATROOM_ID}
        machineId={null}
        initialConfig={null}
        onConfirm={onConfirm}
        onDisable={onDisable}
      />
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
