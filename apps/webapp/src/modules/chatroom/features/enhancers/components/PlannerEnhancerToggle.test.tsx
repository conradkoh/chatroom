import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlannerEnhancerToggle } from './PlannerEnhancerToggle';
import type { EnhancerConfig } from '../types/enhancer';

const mockSaveConfig = vi.fn();
const mockDisable = vi.fn();
const mockDisableEnhancer = vi.fn();
const mockOpenDialog = vi.fn();

let mockConfig: EnhancerConfig | null = null;
let mockIsActive = false;
let mockIsEnhancing = false;

vi.mock('../hooks/useEnhancerConfigDialogHost', () => ({
  useEnhancerConfigDialogHost: () => ({
    config: mockConfig,
    isActive: mockIsActive,
    saveConfig: mockSaveConfig,
    disable: mockDisable,
    favorites: [],
    removeFavorite: vi.fn(),
    moveFavorite: vi.fn(),
    openDialog: mockOpenDialog,
    dialog: null,
  }),
}));

vi.mock('../hooks/useActiveEnhancerJob', () => ({
  useActiveEnhancerJob: () => ({
    isEnhancing: mockIsEnhancing,
    disableEnhancer: mockDisableEnhancer,
    isDisabling: false,
  }),
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
    expect(screen.getByText('Enhancement Disabled')).toBeInTheDocument();
  });

  it('opens dialog when toggling without saved config', async () => {
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));
    await waitFor(() => expect(mockOpenDialog).toHaveBeenCalled());
  });

  it('enables from saved config without opening dialog', async () => {
    mockConfig = SAVED_CONFIG;
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));
    await waitFor(() =>
      expect(mockSaveConfig).toHaveBeenCalledWith({ ...SAVED_CONFIG, enabled: true })
    );
    expect(mockOpenDialog).not.toHaveBeenCalled();
  });

  it('disables when active and not enhancing', async () => {
    mockConfig = { ...SAVED_CONFIG, enabled: true };
    mockIsActive = true;
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));
    await waitFor(() => expect(mockDisable).toHaveBeenCalled());
  });

  it('cancels active job when disabling while enhancing', async () => {
    mockConfig = { ...SAVED_CONFIG, enabled: true };
    mockIsActive = true;
    mockIsEnhancing = true;
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));
    await waitFor(() => expect(mockDisableEnhancer).toHaveBeenCalled());
  });
});
