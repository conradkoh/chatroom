import { act, render, screen } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAgentControls } from './AgentControls';
import type { MachineConfigEntry } from '../features/machine-config/types/machineConfig';
import type { AgentConfig, AgentHarness, MachineInfo, SendCommandFn } from '../types/machine';

// Favourites and model filter come from the mocked useSessionQuery, keyed by query name.
let favoritesState: { favorites: MachineConfigEntry[] } | undefined;
let hiddenModels: string[] = [];

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: (query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    if (query === 'machineConfigFavorites:getMachineConfigFavorites') return favoritesState;
    if (query === 'machines:getMachineModelFilters') {
      return hiddenModels.length > 0 ? { hiddenModels, hiddenProviders: [] } : null;
    }
    return undefined;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    agents: {
      requestStop: 'agents:requestStop',
      requestStopAll: 'agents:requestStopAll',
    },
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
    },
  },
}));

vi.mock('../../../hooks/useMachineModels', () => ({
  useMachineModels: () => ({
    availableModels: {
      'opencode-sdk': ['m1', 'm2', 'm3'],
      'pi-sdk': ['p1'],
    },
    isLoading: false,
  }),
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

const CHATROOM_ID = 'n576raxak4gfqyr503d22dmf718a9p4w' as Id<'chatroom_rooms'>;
const TEAM_ID = 'duo';

function mkMachine(id: string, availableHarnesses: MachineInfo['availableHarnesses']): MachineInfo {
  return {
    machineId: id,
    hostname: `host-${id}`,
    os: 'darwin',
    availableHarnesses,
    harnessVersions: {},
  };
}

function mkRoleConfig(
  machineId: string,
  agentType: AgentConfig['agentType'],
  model: string
): AgentConfig {
  return {
    role: 'planner',
    machineId,
    hostname: `host-${machineId}`,
    agentType,
    model,
    workingDir: '/code',
    availableHarnesses: [agentType],
    updatedAt: Date.now(),
  };
}

/** Renders the hook output as text and exposes a button that makes an explicit harness choice. */
function Harness({
  machines,
  agentConfigs = [],
  teamConfigHarness,
}: {
  machines: MachineInfo[];
  agentConfigs?: AgentConfig[];
  teamConfigHarness?: AgentHarness;
}) {
  const controls = useAgentControls({
    role: 'planner',
    chatroomId: CHATROOM_ID,
    connectedMachines: machines,
    agentConfigs,
    sendCommand: vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn,
    teamId: TEAM_ID,
    // Without persisted config, initialization only selects a machine when the team names one.
    // A team machine does not seed the harness, so the favourite default still applies.
    teamConfigMachineId: 'machine-a',
    teamConfigHarness,
  });
  return (
    <div>
      <span data-testid="harness">{controls.selectedHarness ?? 'none'}</span>
      <span data-testid="model">{controls.selectedModel ?? 'none'}</span>
      <button type="button" onClick={() => controls.handleHarnessChange('pi-sdk')}>
        pick-pi
      </button>
      <button type="button" onClick={() => controls.handleMachineChange('machine-b')}>
        pick-machine-b
      </button>
    </div>
  );
}

function entry(
  agentHarness: MachineConfigEntry['agentHarness'],
  model: string
): MachineConfigEntry {
  return { agentHarness, model };
}

const BOTH_HARNESSES: MachineInfo['availableHarnesses'] = ['opencode-sdk', 'pi-sdk'];

beforeEach(() => {
  favoritesState = undefined;
  hiddenModels = [];
});

describe('favourite-based default harness and model', () => {
  it('selects the top favourite when there is no persisted state', () => {
    favoritesState = {
      favorites: [entry('opencode-sdk', 'm2'), entry('pi-sdk', 'p1')],
    };
    render(<Harness machines={[mkMachine('machine-a', BOTH_HARNESSES)]} />);

    expect(screen.getByTestId('harness').textContent).toBe('opencode-sdk');
    expect(screen.getByTestId('model').textContent).toBe('m2');
  });

  it('skips a top favourite whose harness is not installed and uses the next usable one', () => {
    favoritesState = {
      favorites: [entry('cursor-sdk', 'c1'), entry('pi-sdk', 'p1')],
    };
    render(<Harness machines={[mkMachine('machine-a', BOTH_HARNESSES)]} />);

    expect(screen.getByTestId('harness').textContent).toBe('pi-sdk');
    expect(screen.getByTestId('model').textContent).toBe('p1');
  });

  it('keeps the persisted harness and model when a role config exists', () => {
    favoritesState = {
      favorites: [entry('opencode-sdk', 'm2')],
    };
    render(
      <Harness
        machines={[mkMachine('machine-a', BOTH_HARNESSES)]}
        agentConfigs={[mkRoleConfig('machine-a', 'pi-sdk', 'p1')]}
      />
    );

    expect(screen.getByTestId('harness').textContent).toBe('pi-sdk');
    expect(screen.getByTestId('model').textContent).toBe('p1');
  });

  it('does not let a late favourites load override an explicit harness choice', () => {
    const machines = [mkMachine('machine-a', BOTH_HARNESSES)];
    const { rerender } = render(<Harness machines={machines} />);
    expect(screen.getByTestId('harness').textContent).toBe('none');

    // The user picks a harness while favourites are still loading.
    act(() => {
      screen.getByText('pick-pi').click();
    });
    expect(screen.getByTestId('harness').textContent).toBe('pi-sdk');

    // Favourites arrive afterwards and would pick opencode-sdk. The choice must stand.
    favoritesState = { favorites: [entry('opencode-sdk', 'm2')] };
    rerender(<Harness machines={machines} />);

    expect(screen.getByTestId('harness').textContent).toBe('pi-sdk');
  });

  it('a persisted snapshot on the machine the user switches to beats that machine favourite', () => {
    favoritesState = { favorites: [entry('opencode-sdk', 'm2')] };
    const machines = [
      mkMachine('machine-a', BOTH_HARNESSES),
      mkMachine('machine-b', BOTH_HARNESSES),
    ];
    const { rerender } = render(<Harness machines={machines} />);
    expect(screen.getByTestId('harness').textContent).toBe('opencode-sdk');

    // machine-b gains a persisted snapshot while machine-a's default is already decided.
    rerender(
      <Harness machines={machines} agentConfigs={[mkRoleConfig('machine-b', 'pi-sdk', 'p1')]} />
    );
    act(() => {
      screen.getByText('pick-machine-b').click();
    });

    // Switching clears the harness. The favourite must not fill it because machine-b has a snapshot.
    expect(screen.getByTestId('harness').textContent).toBe('none');
  });

  it('a usable team-config harness beats the top favourite', () => {
    favoritesState = { favorites: [entry('opencode-sdk', 'm2')] };
    render(
      <Harness machines={[mkMachine('machine-a', BOTH_HARNESSES)]} teamConfigHarness="pi-sdk" />
    );

    expect(screen.getByTestId('harness').textContent).toBe('pi-sdk');
    expect(screen.getByTestId('model').textContent).toBe('p1');
  });

  it('falls back to the first visible model when the favourite model is hidden', () => {
    favoritesState = {
      favorites: [entry('opencode-sdk', 'm2')],
    };
    hiddenModels = ['m2'];
    render(<Harness machines={[mkMachine('machine-a', BOTH_HARNESSES)]} />);

    expect(screen.getByTestId('harness').textContent).toBe('opencode-sdk');
    expect(screen.getByTestId('model').textContent).toBe('m1');
  });
});
