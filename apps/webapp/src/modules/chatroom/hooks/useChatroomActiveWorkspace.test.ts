import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useChatroomActiveWorkspace } from './useChatroomActiveWorkspace';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockWorkspaces = vi.fn<() => unknown[]>();
const mockActiveWorkspace = vi.fn<() => unknown>();

vi.mock('../context/ChatroomWorkspaceContext', () => ({
  useChatroomWorkspace: () => ({
    workspaces: mockWorkspaces(),
    activeWorkspace: mockActiveWorkspace(),
    isLoading: false,
  }),
}));

const CHATROOM_ID = 'cr1' as never;

function makeWorkspace(overrides: {
  id?: string;
  machineId?: string | null;
  workingDir?: string;
  hostname?: string;
  machineAlias?: string;
  _registryId?: string;
}) {
  return {
    id: overrides.id ?? 'ws1',
    machineId: 'machineId' in overrides ? overrides.machineId : 'm1',
    workingDir: overrides.workingDir ?? '/proj',
    hostname: overrides.hostname ?? 'laptop',
    machineAlias: overrides.machineAlias,
    agentRoles: [],
    fileTreeSyncEnabled: true,
    _registryId: overrides._registryId,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useChatroomActiveWorkspace', () => {
  it('returns null when no workspaces exist', () => {
    mockWorkspaces.mockReturnValue([]);
    mockActiveWorkspace.mockReturnValue(null);
    const { result } = renderHook(() => useChatroomActiveWorkspace(CHATROOM_ID));
    expect(result.current.activeWorkspace).toBeNull();
    expect(result.current.workspaces).toHaveLength(0);
  });

  it('returns first configured workspace when only one exists', () => {
    const ws = makeWorkspace({ machineId: 'm1', workingDir: '/code', hostname: 'box' });
    mockWorkspaces.mockReturnValue([ws]);
    mockActiveWorkspace.mockReturnValue(ws);
    const { result } = renderHook(() => useChatroomActiveWorkspace(CHATROOM_ID));
    expect(result.current.activeWorkspace).not.toBeNull();
    expect(result.current.activeWorkspace?.machineId).toBe('m1');
    expect(result.current.activeWorkspace?.workingDir).toBe('/code');
    expect(result.current.activeWorkspace?.hostname).toBe('box');
  });

  it('returns the workspace selected by the chatroom context', () => {
    const unassigned = makeWorkspace({ machineId: null, workingDir: '' });
    const connected = makeWorkspace({ machineId: 'm2', workingDir: '/proj2', hostname: 'srv' });
    mockWorkspaces.mockReturnValue([unassigned, connected]);
    mockActiveWorkspace.mockReturnValue(connected);
    const { result } = renderHook(() => useChatroomActiveWorkspace(CHATROOM_ID));
    expect(result.current.activeWorkspace?.machineId).toBe('m2');
  });

  it('ignores the deprecated local index argument', () => {
    const ws0 = makeWorkspace({ id: 'a', machineId: 'mA', workingDir: '/a' });
    const ws1 = makeWorkspace({ id: 'b', machineId: 'mB', workingDir: '/b' });
    mockWorkspaces.mockReturnValue([ws0, ws1]);
    mockActiveWorkspace.mockReturnValue(ws1);

    const { result: r0 } = renderHook(() => useChatroomActiveWorkspace(CHATROOM_ID, 0));
    expect(r0.current.activeWorkspace?.machineId).toBe('mB');
  });

  it('prefers machineAlias over hostname when set', () => {
    const ws = makeWorkspace({ machineId: 'm1', hostname: 'raw-host', machineAlias: 'My Mac' });
    mockWorkspaces.mockReturnValue([ws]);
    mockActiveWorkspace.mockReturnValue(ws);
    const { result } = renderHook(() => useChatroomActiveWorkspace(CHATROOM_ID));
    expect(result.current.activeWorkspace?.hostname).toBe('My Mac');
  });
});
