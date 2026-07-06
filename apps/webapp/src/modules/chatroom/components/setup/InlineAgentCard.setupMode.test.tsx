import { render, waitFor } from '@testing-library/react';
import React, { useRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentConfig, MachineInfo, SendCommandFn } from '../../types/machine';
import { InlineAgentCard } from '../AgentPanel/InlineAgentCard';

vi.mock('../../workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({
    workspaces: [],
    isLoading: false,
    removeWorkspace: vi.fn(),
  }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: () => null,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
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
    },
    isLoading: false,
  }),
}));

const CHATROOM_ID = 'jd7testchatroom0000000000000001';
const MACHINE_ID = 'machine-setup-test';
const WORKING_DIR = '/tmp/workspace';

function mkMachine(): MachineInfo {
  return {
    machineId: MACHINE_ID,
    hostname: 'dev-mac',
    os: 'darwin',
    availableHarnesses: ['cursor-sdk'],
    harnessVersions: {},
  };
}

/** Mirrors SetupAgentTeamStep's pre-fix inline callback pattern. */
function UnstableCallbackHarness({ onConfigChange }: { onConfigChange: (calls: number) => void }) {
  const [, setConfigs] = useState(new Map<string, { harness: string; model: string }>());
  const renderCount = useRef(0);
  renderCount.current += 1;
  if (renderCount.current > 30) {
    throw new Error('Too many renders — setup config sync loop detected');
  }

  return (
    <InlineAgentCard
      role="builder"
      allRoles={['builder']}
      online={false}
      prompt=""
      chatroomId={CHATROOM_ID}
      connectedMachines={[mkMachine()]}
      isLoadingMachines={false}
      agentConfigs={[] as AgentConfig[]}
      sendCommand={vi.fn().mockResolvedValue(undefined) as unknown as SendCommandFn}
      setupMode
      lockedMachineId={MACHINE_ID}
      lockedWorkingDir={WORKING_DIR}
      onSetupConfigChange={(harness, model) => {
        onConfigChange(1);
        if (!harness || !model) return;
        setConfigs((prev) => {
          const next = new Map(prev);
          next.set('builder', { harness, model });
          return next;
        });
      }}
    />
  );
}

describe('InlineAgentCard setup mode config sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not re-sync setup config on every parent render when harness/model are stable', async () => {
    let syncCalls = 0;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<UnstableCallbackHarness onConfigChange={() => syncCalls++} />);

    await waitFor(() => {
      expect(syncCalls).toBeGreaterThan(0);
    });

    const callsAfterSettle = syncCalls;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(syncCalls).toBe(callsAfterSettle);

    const depthErrors = consoleError.mock.calls.filter(([msg]) =>
      String(msg).includes('Maximum update depth exceeded')
    );
    expect(depthErrors).toHaveLength(0);

    consoleError.mockRestore();
  });
});
