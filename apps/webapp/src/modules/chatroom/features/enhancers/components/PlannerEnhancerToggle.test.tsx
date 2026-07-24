import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlannerEnhancerToggle } from './PlannerEnhancerToggle';
import type { EnhancerConfig } from '../types/enhancer';

const mockSaveConfig = vi.fn();
const mockDisable = vi.fn();
const mockDisableEnhancer = vi.fn();

let mockConfig: EnhancerConfig | null = null;
let mockIsActive = false;
let mockIsEnhancing = false;

vi.mock('./EnhancerConfigDialog', () => ({
  EnhancerConfigDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Enhancer configuration</div> : null,
}));

vi.mock('../hooks/useEnhancerConfig', () => ({
  useEnhancerConfig: () => ({
    config: mockConfig,
    isActive: mockIsActive,
    saveConfig: mockSaveConfig,
    disable: mockDisable,
  }),
}));

vi.mock('../hooks/useActiveEnhancerJob', () => ({
  useActiveEnhancerJob: () => ({
    isEnhancing: mockIsEnhancing,
    disableEnhancer: mockDisableEnhancer,
    isDisabling: false,
  }),
}));

vi.mock('@/hooks/useMachineModels', () => ({
  useMachineModels: () => ({ availableModels: {}, isLoading: false }),
}));

const SAVED_CONFIG: EnhancerConfig = {
  enabled: false,
  targetId: 'handoff:planner-to-builder',
  agentHarness: 'cursor',
  model: 'gpt-4',
  machineId: 'machine-1',
};

describe('PlannerEnhancerToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig = null;
    mockIsActive = false;
    mockIsEnhancing = false;
  });

  it('renders toggle button always', () => {
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    expect(screen.getByTestId('planner-enhancer-toggle')).toBeInTheDocument();
  });

  it('shows inactive state by default', () => {
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    expect(screen.getByTestId('planner-enhancer-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens config dialog when toggling on with no config', () => {
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('re-enables saved config without opening dialog', () => {
    mockConfig = SAVED_CONFIG;

    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));

    expect(mockSaveConfig).toHaveBeenCalledWith({ ...SAVED_CONFIG, enabled: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('disables enhancer when toggling off while active', () => {
    mockIsActive = true;

    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));

    expect(mockDisable).toHaveBeenCalled();
    expect(mockDisableEnhancer).not.toHaveBeenCalled();
  });

  it('uses disableEnhancer when toggling off during active job', () => {
    mockIsActive = true;
    mockIsEnhancing = true;

    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));

    expect(mockDisableEnhancer).toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('opens config dialog from context menu Configure', async () => {
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.contextMenu(screen.getByTestId('planner-enhancer-toggle'));

    await waitFor(() => {
      expect(screen.getByTestId('planner-enhancer-configure')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('planner-enhancer-configure'));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('applies pulse animation when enhancing', () => {
    mockIsEnhancing = true;

    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    expect(screen.getByTestId('planner-enhancer-toggle')).toHaveClass('animate-pulse');
  });
});
