import { render, screen, waitFor } from '@testing-library/react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RemoteTabContent, useAgentControls } from './AgentControls';
import type { AgentConfig, MachineInfo, SendCommandFn } from '../types/machine';

vi.mock('../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({
    workspaces: [],
    isLoading: false,
    removeWorkspace: vi.fn(),
  }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: () => undefined,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machines: {
      getMachineModels: 'machines:getMachineModels',
      getMachineModelFilters: 'machines:getMachineModelFilters',
      upsertMachineModelFilters: 'machines:upsertMachineModelFilters',
      requestCapabilitiesRefresh: 'machines:requestCapabilitiesRefresh',
      getCapabilitiesRefreshBatch: 'machines:getCapabilitiesRefreshBatch',
    },
  },
}));

const CHATROOM_ID = 'jd7testchatroom0000000000000001';

function mkMachine(id: string): MachineInfo {
  return {
    machineId: id,
    hostname: `host-${id}`,
    os: 'linux',
    availableHarnesses: ['cursor-sdk'],
    harnessVersions: {},
  };
}

function mkRunningConfig(wantResume: boolean): AgentConfig {
  return {
    machineId: 'a',
    hostname: 'host-a',
    role: 'builder',
    agentType: 'cursor-sdk',
    workingDir: '/workspace',
    availableHarnesses: ['cursor-sdk'],
    updatedAt: Date.now(),
    spawnedAgentPid: 4242,
    spawnedAt: Date.now(),
    wantResume,
  };
}

function Harness({
  agentConfigs,
  sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn,
}: {
  agentConfigs: AgentConfig[];
  sendCommand?: SendCommandFn;
}) {
  const machines = [mkMachine('a')];
  const controls = useAgentControls({
    role: 'builder',
    chatroomId: CHATROOM_ID as Id<'chatroom_rooms'>,
    connectedMachines: machines,
    agentConfigs,
    sendCommand,
  });
  return (
    <RemoteTabContent
      controls={controls}
      connectedMachines={machines}
      isLoadingMachines={false}
      daemonStartCommand="chatroom daemon"
      chatroomId={CHATROOM_ID}
      role="builder"
    />
  );
}

describe('AgentControls resume toggle persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Resume session for daemon-memory-capable harnesses', async () => {
    render(<Harness agentConfigs={[mkRunningConfig(true)]} />);

    await waitFor(() => {
      expect(screen.getByTitle('Stop Agent')).toBeInTheDocument();
    });
    expect(screen.getByRole('switch', { name: 'Resume session' })).toBeInTheDocument();
  });
});
