import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatroomPageClient } from './ChatroomPageClient';

import type * as ChatroomModule from '@/modules/chatroom';

const mockUseSessionQuery = vi.fn();
const CHATROOM_ID = 'n576raxak4gfqyr503d22dmf718a9p4w';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`id=${CHATROOM_ID}`),
}));

vi.mock('@/modules/chatroom/hooks/persistence/useChatroomListingSidebarVisible', () => ({
  useChatroomListingSidebarVisible: () => [false, vi.fn()],
}));

vi.mock('@/modules/chatroom/hooks/useObserveChatroom', () => ({
  useObserveChatroom: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/modules/chatroom/components/ChatroomSidebar', () => ({
  ChatroomSidebar: () => <div data-testid="chatroom-sidebar" />,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => vi.fn().mockResolvedValue(undefined),
  useSessionQuery: (query: unknown, args: unknown) => {
    mockUseSessionQuery(query, args);
    if (query === 'machineConfigFavorites:getMachineConfigFavorites' && args !== 'skip') {
      return { favorites: [] };
    }
    if (query === 'machines:getAgentRestartSummariesByRoles') {
      return [];
    }
    if (query === 'machines:getAgentRestartSummaryByRole') {
      return null;
    }
    return undefined;
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
      getAgentRestartSummariesByRoles: 'machines:getAgentRestartSummariesByRoles',
      getAgentRestartSummaryByRole: 'machines:getAgentRestartSummaryByRole',
      setWantResume: 'machines:setWantResume',
    },
  },
}));

vi.mock('@/hooks/useMachineModels', () => ({
  useMachineModels: () => ({
    availableModels: {
      'opencode-sdk': ['opencode/big-pickle'],
    },
    isLoading: false,
  }),
}));

vi.mock('@/lib/environment', () => ({
  getDaemonStartCommand: () => 'chatroom daemon',
}));

vi.mock('@/contexts/PromptsContext', () => ({
  PromptsContext: React.createContext({ getAgentPrompt: () => '' }),
}));

vi.mock('@/modules/chatroom/hooks/useAgentPanelData', () => ({
  useAgentPanelData: () => ({
    agents: [
      {
        role: 'planner',
        type: 'remote',
        state: 'stopped',
        model: 'opencode/big-pickle',
        agentHarness: 'opencode-sdk',
        machineId: 'machine-a',
      },
    ],
    teamRoles: ['planner'],
    connectedMachines: [
      {
        machineId: 'machine-a',
        hostname: 'host-a',
        os: 'darwin',
        availableHarnesses: ['opencode-sdk'],
        harnessVersions: {},
      },
    ],
    machineConfigs: [
      {
        role: 'planner',
        machineId: 'machine-a',
        agentType: 'opencode-sdk',
        model: 'opencode/big-pickle',
        workingDir: '/code',
        updatedAt: Date.now(),
      },
    ],
    sendCommand: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    teamId: 'duo',
  }),
}));

vi.mock('@/modules/chatroom/hooks/useAgentStatuses', () => ({
  useAgentStatuses: () => ({
    agents: [
      {
        role: 'planner',
        online: false,
        lastSeenAt: null,
        latestEventType: null,
        statusVariant: 'offline',
      },
    ],
  }),
}));

vi.mock('@/modules/chatroom/workspace/hooks/useChatroomWorkspaces', () => ({
  useChatroomWorkspaces: () => ({
    workspaces: [
      {
        machineId: 'machine-a',
        workingDir: '/code',
        id: 'machine-a::/code',
        hostname: 'dev',
        machineAlias: undefined,
        agentRoles: [],
        _registryId: 'r1',
      },
    ],
    isLoading: false,
    removeWorkspace: vi.fn(),
  }),
}));

vi.mock('@/components/ui/fixed-modal', () => ({
  FixedModal: ({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) =>
    isOpen ? <div data-testid="fixed-modal">{children}</div> : null,
  FixedModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  FixedModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FixedModalSidebar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/modules/chatroom', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof ChatroomModule;
  const { AgentSettingsModal } = await import('@/modules/chatroom/components/AgentSettingsModal');
  return {
    ...actual,
    ChatroomDashboard: ({ chatroomId }: { chatroomId: string }) => (
      <AgentSettingsModal
        isOpen
        onClose={() => undefined}
        chatroomId={chatroomId}
        currentTeamId="duo"
        currentTeamRoles={['planner']}
        initialTab="agents"
      />
    ),
  };
});

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

describe('Chatroom page agents settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads machine config favorites with teamRoleKey when agents tab is open', async () => {
    render(<ChatroomPageClient />);

    await waitFor(() => {
      expect(mockUseSessionQuery).toHaveBeenCalledWith(
        'machineConfigFavorites:getMachineConfigFavorites',
        {
          machineId: 'machine-a',
          teamRoleKey: 'team_duo#role_planner',
        }
      );
    });
  });
});
