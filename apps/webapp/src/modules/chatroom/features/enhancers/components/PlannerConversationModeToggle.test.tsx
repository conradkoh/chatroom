import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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
let mockSetMode = vi.fn((newMode: 'chat' | 'code' | 'code:enhanced') => {
  mockMode = newMode;
});

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

/** Create a deferred promise for controlling async test timing. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('PlannerConversationModeToggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatform('MacIntel');
    mockConfig = null;
    mockIsActive = false;
    mockMode = 'code';
    mockSetMode = vi.fn((newMode: 'chat' | 'code' | 'code:enhanced') => {
      mockMode = newMode;
    });
  });

  it('renders toggle button always', () => {
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);
    expect(screen.getByTestId('planner-conversation-mode-toggle')).toBeInTheDocument();
  });

  it('shows Code mode by default', () => {
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);
    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('cycles from Code to Enhanced optimistically before mutation resolves', async () => {
    mockMode = 'code';
    mockConfig = SAVED_CONFIG;
    const deferred = createDeferred<void>();
    mockSaveConfig.mockReturnValue(deferred.promise);

    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    });

    // Optimistic: setMode called immediately
    expect(mockSetMode).toHaveBeenCalledWith('code:enhanced');

    // Mutation was initiated (async microtask flushed by act)
    expect(mockSaveConfig).toHaveBeenCalledWith({ ...SAVED_CONFIG, enabled: true });

    // Resolve the mutation
    deferred.resolve();
    await act(async () => {});
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('opens dialog when cycling to Enhanced without complete config', async () => {
    mockMode = 'code';
    mockConfig = null;
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    });
    await waitFor(() => expect(mockOpenDialog).toHaveBeenCalled());
    // No mode change — incomplete config cannot be optimistically committed
    expect(mockSetMode).not.toHaveBeenCalled();
  });

  it('disables enhancer optimistically when leaving Enhanced to Chat', async () => {
    mockMode = 'code:enhanced';
    const deferred = createDeferred<void>();
    mockDisable.mockReturnValue(deferred.promise);

    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    });

    // Optimistic: setMode called immediately
    expect(mockSetMode).toHaveBeenCalledWith('chat');

    // Mutation was initiated
    expect(mockDisable).toHaveBeenCalled();

    deferred.resolve();
    await act(async () => {});
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it('rolls back to Code when saveConfig rejects and shows error', async () => {
    mockMode = 'code';
    mockConfig = SAVED_CONFIG;
    const deferred = createDeferred<void>();
    mockSaveConfig.mockReturnValue(deferred.promise);

    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    });

    // Optimistic: setMode called immediately
    expect(mockSetMode).toHaveBeenCalledWith('code:enhanced');

    // Reject the mutation
    await act(async () => {
      deferred.reject(new Error('save failed'));
    });
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to enable enhancement. Reverted to previous mode.'
    );
  });

  it('rolls back to Enhanced when disable rejects and shows error', async () => {
    mockMode = 'code:enhanced';
    const deferred = createDeferred<void>();
    mockDisable.mockReturnValue(deferred.promise);

    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    });

    // Optimistic: setMode called immediately
    expect(mockSetMode).toHaveBeenCalledWith('chat');

    // Reject the mutation
    await act(async () => {
      deferred.reject(new Error('disable failed'));
    });
    expect(mockToastError).toHaveBeenCalledWith(
      'Failed to disable enhancement. Keeping Enhanced mode.'
    );
  });

  it('cycles directly for Chat to Code (no mutation)', async () => {
    mockMode = 'chat';
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    await act(async () => {
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    });
    await waitFor(() => expect(mockSetMode).toHaveBeenCalledWith('code'));
    // Non-boundary: no backend mutation needed
    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(mockDisable).not.toHaveBeenCalled();
  });

  it('unsupported team shows toast and does not cycle', async () => {
    render(
      <PlannerConversationModeToggle
        chatroomId="room-1"
        machineId="machine-1"
        teamSupportState="unsupported"
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    });
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

    await act(async () => {
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    });
    expect(mockSetMode).not.toHaveBeenCalled();
  });

  it('Ctrl+M cycles mode optimistically', async () => {
    mockMode = 'code';
    mockConfig = SAVED_CONFIG;
    const deferred = createDeferred<void>();
    mockSaveConfig.mockReturnValue(deferred.promise);

    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', ctrlKey: true, bubbles: true })
      );
    });

    expect(mockSetMode).toHaveBeenCalledWith('code:enhanced');
    deferred.resolve();
    await act(async () => {});
    expect(mockSaveConfig).toHaveBeenCalled();
  });

  it('Ctrl+M shows unsupported toast for unsupported teams', async () => {
    render(
      <PlannerConversationModeToggle
        chatroomId="room-1"
        machineId="machine-1"
        teamSupportState="unsupported"
      />
    );

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', ctrlKey: true, bubbles: true })
      );
    });

    await waitFor(() => expect(mockToastMessage).toHaveBeenCalled());
    expect(mockSetMode).not.toHaveBeenCalled();
  });

  it('Ctrl+E does not trigger the mode toggle', async () => {
    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', ctrlKey: true, bubbles: true })
      );
    });

    expect(mockSetMode).not.toHaveBeenCalled();
    expect(mockToastMessage).not.toHaveBeenCalled();
  });

  it('button remains activatable while busy for optimistic rapid activation', async () => {
    mockMode = 'code';
    mockConfig = SAVED_CONFIG;
    const deferred = createDeferred<void>();
    mockSaveConfig.mockReturnValue(deferred.promise);

    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);
    const button = screen.getByTestId('planner-conversation-mode-toggle');

    // First click — initiates enable
    await act(async () => {
      fireEvent.click(button);
    });
    expect(mockSetMode).toHaveBeenCalledWith('code:enhanced');

    // Button should show busy state but remain activatable (not natively disabled)
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).not.toBeDisabled();

    // Resolve the first mutation
    await act(async () => {
      deferred.resolve();
    });
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
  });

  it('rapid Enhanced → Chat accepted with serialized mutations', async () => {
    mockMode = 'code';
    mockConfig = SAVED_CONFIG;
    const enableDeferred = createDeferred<void>();
    mockSaveConfig.mockReturnValue(enableDeferred.promise);

    render(<PlannerConversationModeToggle chatroomId="room-1" machineId="machine-1" />);

    // Click 1: Code → Enhanced (enable) — optimistic setMode called
    await act(async () => {
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
    });
    expect(mockSetMode).toHaveBeenCalledWith('code:enhanced');
    expect(mockSaveConfig).toHaveBeenCalledTimes(1);

    // Resolve enable while switching to Chat in parallel
    const disableDeferred = createDeferred<void>();
    mockDisable.mockReturnValue(disableDeferred.promise);

    // Simulate mode update and second click in same act
    await act(async () => {
      mockMode = 'code:enhanced';
      fireEvent.click(screen.getByTestId('planner-conversation-mode-toggle'));
      enableDeferred.resolve();
    });
    expect(mockSetMode).toHaveBeenCalledWith('chat');
    expect(mockDisable).toHaveBeenCalledTimes(1);

    // Resolve disable
    await act(async () => {
      disableDeferred.resolve();
    });
    expect(mockToastError).not.toHaveBeenCalled();
  });
});
