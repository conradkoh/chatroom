import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    // cursor-sdk supports session resume, so the Resume toggle is rendered.
    availableHarnesses: ['cursor-sdk'],
    harnessVersions: {},
  };
}

/** A running agent config for the 'builder' role with an explicit wantResume. */
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

/** A STOPPED (no spawnedAgentPid) config that still remembers its last wantResume. */
function mkStoppedConfig(wantResume: boolean): AgentConfig {
  return {
    machineId: 'a',
    hostname: 'host-a',
    role: 'builder',
    agentType: 'cursor-sdk',
    workingDir: '/workspace',
    availableHarnesses: ['cursor-sdk'],
    updatedAt: Date.now(),
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

  it('keeps the resume toggle OFF after stopping an agent that ran with wantResume=false', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn;
    const user = userEvent.setup();

    // Agent is running with resume OFF.
    const { rerender } = render(
      <Harness agentConfigs={[mkRunningConfig(false)]} sendCommand={sendCommand} />
    );

    // While running, the toggle reflects the backend value (OFF).
    const toggle = await waitFor(() => screen.getByRole('switch', { name: 'Resume session' }));
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    // Press Stop.
    const stop = await waitFor(() => screen.getByTitle('Stop Agent'));
    await user.click(stop);
    await waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'stop-agent' }))
    );

    // Simulate the backend clearing the running pid (agent stopped).
    rerender(<Harness agentConfigs={[]} sendCommand={sendCommand} />);

    // Regression: the toggle must stay OFF, not snap back to the default ON.
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Resume session' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
    });
  });

  it('keeps the resume toggle ON after stopping an agent that ran with wantResume=true', async () => {
    const sendCommand = vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn;
    const user = userEvent.setup();

    const { rerender } = render(
      <Harness agentConfigs={[mkRunningConfig(true)]} sendCommand={sendCommand} />
    );

    const toggle = await waitFor(() => screen.getByRole('switch', { name: 'Resume session' }));
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    const stop = await waitFor(() => screen.getByTitle('Stop Agent'));
    await user.click(stop);
    await waitFor(() =>
      expect(sendCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'stop-agent' }))
    );

    rerender(<Harness agentConfigs={[]} sendCommand={sendCommand} />);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Resume session' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
    });
  });

  it('shows the resume toggle OFF on fresh load for a STOPPED agent last started with wantResume=false', async () => {
    // Stopped-on-load: no running agent, but the persisted config remembers false.
    // The toggle must seed from that persisted value, not the bare `true` default.
    render(<Harness agentConfigs={[mkStoppedConfig(false)]} />);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Resume session' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
    });
  });

  it('shows the resume toggle ON on fresh load for a STOPPED agent last started with wantResume=true', async () => {
    render(<Harness agentConfigs={[mkStoppedConfig(true)]} />);

    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Resume session' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
    });
  });
});
