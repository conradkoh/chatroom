import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlannerEnhancerToggle } from './PlannerEnhancerToggle';
import type { EnhancerConfig } from '../types/enhancer';

const mockSaveConfig = vi.fn();
const mockDisable = vi.fn();
const mockCancelJob = vi.fn();
const mockOpenDialog = vi.fn();
const mockToastMessage = vi.fn();

vi.mock('sonner', () => ({
  toast: { message: (...args: unknown[]) => mockToastMessage(...args) },
}));

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
    cancelJob: mockCancelJob,
    isCancelling: false,
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
    await waitFor(() => expect(mockOpenDialog).toHaveBeenCalledWith());
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

  it('does not enable an incomplete saved config', async () => {
    mockConfig = { ...SAVED_CONFIG, enabled: true, model: '' };
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));
    await waitFor(() => expect(mockOpenDialog).toHaveBeenCalled());
    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(screen.getByTestId('planner-enhancer-toggle')).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables when active and not enhancing', async () => {
    mockConfig = { ...SAVED_CONFIG, enabled: true };
    mockIsActive = true;
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));
    await waitFor(() => expect(mockDisable).toHaveBeenCalled());
  });

  it('disables without cancelling when enhancing', async () => {
    mockConfig = { ...SAVED_CONFIG, enabled: true };
    mockIsActive = true;
    mockIsEnhancing = true;
    render(<PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));
    await waitFor(() => expect(mockDisable).toHaveBeenCalled());
    expect(mockCancelJob).not.toHaveBeenCalled();
  });

  it('unsupported click calls toast message', async () => {
    render(
      <PlannerEnhancerToggle
        chatroomId="room-1"
        machineId="machine-1"
        teamSupportState="unsupported"
      />
    );

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));
    await waitFor(() => expect(mockToastMessage).toHaveBeenCalled());
    expect(mockOpenDialog).not.toHaveBeenCalled();
  });

  it('loading click does nothing', async () => {
    render(
      <PlannerEnhancerToggle chatroomId="room-1" machineId="machine-1" teamSupportState="loading" />
    );

    fireEvent.click(screen.getByTestId('planner-enhancer-toggle'));
    expect(mockOpenDialog).not.toHaveBeenCalled();
    expect(mockToastMessage).not.toHaveBeenCalled();
  });
});
