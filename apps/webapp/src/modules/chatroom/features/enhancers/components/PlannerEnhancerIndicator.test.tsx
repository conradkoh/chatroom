import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlannerEnhancerIndicator } from './PlannerEnhancerIndicator';

vi.mock('convex-helpers/react/sessions', () => {
  const mock = vi.fn<(...args: unknown[]) => unknown>();
  return {
    useSessionQuery: mock,
    useSessionMutation: vi.fn(() => vi.fn()),
  };
});

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
  },
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

const ACTIVE_JOB = {
  jobId: 'job-1',
  status: 'running' as const,
  attemptCount: 1,
  maxAttempts: 3,
  fromRole: 'planner',
  toRole: 'builder',
};

describe('PlannerEnhancerIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no active job', () => {
    const { container } = render(<PlannerEnhancerIndicator chatroomId="room-1" />);

    expect(container.innerHTML).toBe('');
  });

  it('renders the Sparkles indicator when active job exists', async () => {
    const sessions = await vi.importMock<{
      useSessionQuery: ReturnType<typeof vi.fn>;
    }>('convex-helpers/react/sessions');

    sessions.useSessionQuery.mockReturnValue(ACTIVE_JOB);

    render(<PlannerEnhancerIndicator chatroomId="room-1" />);

    expect(screen.getByTestId('planner-enhancer-indicator')).toBeInTheDocument();
  });

  it('opens popover on click with disable button', async () => {
    const sessions = await vi.importMock<{
      useSessionQuery: ReturnType<typeof vi.fn>;
    }>('convex-helpers/react/sessions');

    sessions.useSessionQuery.mockReturnValue(ACTIVE_JOB);

    render(<PlannerEnhancerIndicator chatroomId="room-1" />);

    fireEvent.click(screen.getByTestId('planner-enhancer-indicator'));

    await waitFor(() => {
      expect(screen.getByTestId('planner-enhancer-disable')).toBeInTheDocument();
    });

    expect(screen.getByText('Enhancing handoff')).toBeInTheDocument();
    expect(screen.getByText(/Attempt 1\/3/)).toBeInTheDocument();
  });

  it('renders nothing when active job goes away', async () => {
    const sessions = await vi.importMock<{
      useSessionQuery: ReturnType<typeof vi.fn>;
    }>('convex-helpers/react/sessions');

    sessions.useSessionQuery.mockReturnValue(ACTIVE_JOB);

    const { container, rerender } = render(<PlannerEnhancerIndicator chatroomId="room-1" />);

    expect(screen.getByTestId('planner-enhancer-indicator')).toBeInTheDocument();

    sessions.useSessionQuery.mockReturnValue(undefined);

    rerender(<PlannerEnhancerIndicator chatroomId="room-1" />);

    expect(container.innerHTML).toBe('');
  });
});
