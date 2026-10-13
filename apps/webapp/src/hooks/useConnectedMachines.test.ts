import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useConnectedMachines } from './useConnectedMachines';

import type { UserMachine } from '@/modules/chatroom/types/machine';

const mocks = vi.hoisted(() => ({
  machines: [] as UserMachine[],
  isLoading: false,
  connectivity: new Map<string, { connected: boolean }>(),
}));

vi.mock('@/hooks/useUserMachines', () => ({
  useUserMachines: () => ({ machines: mocks.machines, isLoading: mocks.isLoading }),
}));

vi.mock('@/hooks/useDaemonConnectivity', () => ({
  useDaemonConnectivity: () => mocks.connectivity,
}));

const online = { machineId: 'machine-online', hostname: 'online' } as UserMachine;
const offline = { machineId: 'machine-offline', hostname: 'offline' } as UserMachine;
const disconnected = { machineId: 'machine-disconnected', hostname: 'disconnected' } as UserMachine;

describe('useConnectedMachines', () => {
  it('splits connected from offline machines, and keeps every machine listed', () => {
    mocks.machines = [online, offline, disconnected];
    mocks.isLoading = false;
    mocks.connectivity = new Map([
      ['machine-online', { connected: true }],
      ['machine-disconnected', { connected: false }],
    ]);

    const { result } = renderHook(() => useConnectedMachines());

    expect(result.current.machines).toEqual([online, offline, disconnected]);
    expect(result.current.connectedMachines).toEqual([online]);
  });

  it('exposes the connected machine ids as a set', () => {
    mocks.machines = [online, offline];
    mocks.isLoading = false;
    mocks.connectivity = new Map([['machine-online', { connected: true }]]);

    const { result } = renderHook(() => useConnectedMachines());

    expect(result.current.connectedMachineIds).toEqual(new Set(['machine-online']));
  });

  it('treats a machine with no connectivity entry as not connected', () => {
    mocks.machines = [offline];
    mocks.isLoading = false;
    mocks.connectivity = new Map();

    const { result } = renderHook(() => useConnectedMachines());

    expect(result.current.connectedMachines).toEqual([]);
    expect(result.current.connectedMachineIds.size).toBe(0);
  });

  it('passes the registry loading state through', () => {
    mocks.machines = [];
    mocks.isLoading = true;
    mocks.connectivity = new Map();

    const { result } = renderHook(() => useConnectedMachines());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.machines).toEqual([]);
  });
});
