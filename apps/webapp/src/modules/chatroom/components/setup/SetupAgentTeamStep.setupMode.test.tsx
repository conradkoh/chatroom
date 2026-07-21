import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SetupAgentTeamStep } from './SetupAgentTeamStep';
import type { AgentConfig, MachineInfo, SendCommandFn } from '../../types/machine';

vi.mock('../../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({
    workspaces: [],
    isLoading: false,
    removeWorkspace: vi.fn(),
  }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: (query: unknown, args: unknown) => {
    if (query === 'machineConfigFavorites:getMachineConfigFavorites' && args !== 'skip') {
      return {
        favorites: [{ agentHarness: 'cursor-sdk', model: 'cursor-sdk/claude-sonnet' }],
      };
    }
    return null;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machineConfigFavorites: {
      getMachineConfigFavorites: 'machineConfigFavorites:getMachineConfigFavorites',
      setMachineConfigFavorites: 'machineConfigFavorites:setMachineConfigFavorites',
    },
    machines: {
      getMachineModels: 'machines:getMachineModels',
      getMachineModelFilters: 'machines:getMachineModelFilters',
      upsertMachineModelFilters: 'machines:upsertMachineModelFilters',
      requestCapabilitiesRefresh: 'machines:requestCapabilitiesRefresh',
      getCapabilitiesRefreshBatch: 'machines:getCapabilitiesRefreshBatch',
      getAgentRestartSummaryByRole: 'machines:getAgentRestartSummaryByRole',
      setWantResume: 'machines:setWantResume',
    },
  },
}));

vi.mock('../../../../hooks/useMachineModels', () => ({
  useMachineModels: () => ({
    availableModels: {
      'cursor-sdk': ['cursor-sdk/claude-sonnet'],
      opencode: ['opencode/claude-sonnet'],
    },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useIsDesktop', () => ({
  useIsDesktop: () => true,
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

const CHATROOM_ID = 'jd7testchatroom0000000000000001';
const MACHINE_ID = 'machine-setup-test';
const WORKING_DIR = '/tmp/workspace';

function mkMachine(): MachineInfo {
  return {
    machineId: MACHINE_ID,
    hostname: 'dev-mac',
    os: 'darwin',
    availableHarnesses: ['cursor-sdk', 'opencode'],
    harnessVersions: {},
  };
}

function renderSetupStep(overrides?: Partial<React.ComponentProps<typeof SetupAgentTeamStep>>) {
  const sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn;
  const onAllAgentsStarted = vi.fn();
  const onBack = vi.fn();

  const view = render(
    <SetupAgentTeamStep
      chatroomId={CHATROOM_ID}
      teamId="duo"
      teamRoles={['planner', 'builder']}
      participants={[]}
      machineId={MACHINE_ID}
      workingDir={WORKING_DIR}
      connectedMachines={[mkMachine()]}
      isLoadingMachines={false}
      agentConfigs={[] as AgentConfig[]}
      sendCommand={sendCommand}
      agentRoleViews={[]}
      onAllAgentsStarted={onAllAgentsStarted}
      onBack={onBack}
      {...overrides}
    />
  );

  return { ...view, sendCommand, onAllAgentsStarted, onBack };
}

describe('SetupAgentTeamStep setup mode harness selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('does not infinite-loop when selecting a harness for an agent', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderSetupStep();

    await waitFor(() => {
      expect(screen.getAllByTitle('Select Harness').length).toBeGreaterThan(0);
    });

    const harnessButtons = screen.getAllByTitle('Select Harness');
    await userEvent.click(harnessButtons[0]!);

    const harnessOption = await screen.findByText('Cursor (SDK)');
    await userEvent.click(harnessOption);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Reconnect to last session' })).toBeInTheDocument();
    });

    const depthErrors = consoleError.mock.calls.filter(([msg]) =>
      String(msg).includes('Maximum update depth exceeded')
    );
    expect(depthErrors).toHaveLength(0);

    consoleError.mockRestore();
  });

  it('hides reconnect toggle for duo builder in setup mode', async () => {
    renderSetupStep();

    await waitFor(() => {
      expect(screen.getAllByTitle('Select Harness').length).toBe(2);
    });

    const harnessButtons = screen.getAllByTitle('Select Harness');
    await userEvent.click(harnessButtons[1]!);

    const harnessOption = await screen.findByText('Cursor (SDK)');
    await userEvent.click(harnessOption);

    await waitFor(() => {
      expect(
        screen.queryByRole('switch', { name: 'Reconnect to last session' })
      ).not.toBeInTheDocument();
    });
  });

  it('shows favorites section in setup mode when teamId is provided', async () => {
    renderSetupStep();

    await waitFor(() => {
      expect(screen.getAllByTestId('machine-config-quick-pick').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('Favorites').length).toBeGreaterThan(0);
  });
});
