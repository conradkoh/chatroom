import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlannerConversationModeToggle } from './PlannerConversationModeToggle';
import type { EnhancerConfig } from '../types/enhancer';

const mockSaveConfig = vi.fn();
const mockDisable = vi.fn();
const mockOpenDialog = vi.fn();
const mockToastMessage = vi.fn();
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    message: (...args: unknown[]) => mockToastMessage(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

let mockConfig: EnhancerConfig | null = null;
let mockIsActive = false;

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

const SAVED_CONFIG: EnhancerConfig = {
  enabled: false,
  targetId: 'handoff:planner-to-builder',
  agentHarness: 'cursor',
  model: 'gpt-4',
  machineId: 'machine-1',
};

// Mock the conversation mode context
let mockMode = 'code' as 'chat' | 'code' | 'code:enhanced';
let mockSetMode = vi.fn();

vi.mock('../../../hooks/useConversationMode', () => ({
  useConversationMode: () => ({
    mode: mockMode,
    setMode: mockSetMode,
    hasUserSelected: false,
  }),
}));

function mockPlatform(platform: string) {
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: platform,
  });
}

describe('PlannerConversationModeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform('MacIntel');
    mockConfig = null;
    mockIsActive = false;
    mockMode = 'code';
    mockSetMode = vi.fn();
  });

  it('renders toggle button always', () => {
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    expect(screen.getByTestId('planner-conversation-mode-toggle')).toBeInTheDocument();
  });

  it('shows Code mode by default', () => {
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('cycles from Code to Enhanced when config is complete', async () => {
    mockMode = 'code';
    mockConfig = SAVED_CONFIG;
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    await waitFor(() =>
      expect(mockSaveConfig).toHaveBeenCalledWith({ ...SAVED_CONFIG, enabled: true })
    );
    expect(mockSetMode).toHaveBeenCalledWith('code:enhanced');
  });

  it('opens dialog when cycling to Enhanced without complete config', async () => {
    mockMode = 'code';
    mockConfig = null;
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    await waitFor(() => expect(mockOpenDialog).toHaveBeenCalled());
    expect(mockSetMode).not.toHaveBeenCalled();
  });

  it('disables enhancer when leaving Enhanced to Chat', async () => {
    mockMode = 'code:enhanced';
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    await waitFor(() => expect(mockDisable).toHaveBeenCalled());
    expect(mockSetMode).toHaveBeenCalledWith('chat');
  });

  it('shows error toast when disable fails', async () => {
    mockMode = 'code:enhanced';
    mockDisable.mockRejectedValue(new Error('disable failed'));
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    await waitFor(() => expect(mockToastError).toHaveBeenCalled());
    expect(mockSetMode).not.toHaveBeenCalled();
  });

  it('cycles directly for Chat to Code', async () => {
    mockMode = 'chat';
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    await waitFor(() => expect(mockSetMode).toHaveBeenCalledWith('code'));
  });

  it('unsupported team shows toast and does not cycle', async () => {
    render(
      <PlannerConversationModeToggle
        chatroomId="room-1"
        machineId="machine-1"
        teamSupportState="unsupported"
      />
    );

    fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    await waitFor(() => expect(mockToastMessage).toHaveBeenCalled());
    expect(mockSetMode).not.toHaveBeenCalled();
  });

  it('loading state does nothing on click', async () => {
    render(
      <PlannerConversationModeToggle
        chatroomId="room-1"
        machineId="machine-1"
        teamSupportState="loading"
      />
    );

    fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    expect(mockSetMode).not.toHaveBeenCalled();
  });

  it('Ctrl+E cycles mode', async () => {
    mockMode = 'code';
    mockConfig = SAVED_CONFIG;
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', ctrlKey: true, bubbles: true })
    );

    await waitFor(() => expect(mockSetMode).toHaveBeenCalledWith('code:enhanced'));
  });

  it('Ctrl+E shows unsupported toast for unsupported teams', async () => {
    render(
      <PlannerConversationModeToggle
        chatroomId="room-1"
        machineId="machine-1"
        teamSupportState="unsupported"
      />
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', ctrlKey: true, bubbles: true })
    );

    await waitFor(() => expect(mockToastMessage).toHaveBeenCalled());
    expect(mockSetMode).not.toHaveBeenCalled();
  });
});
