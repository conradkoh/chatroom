import { renderHook } from '@testing-library/react';
import type { FunctionReference } from 'convex/server';
import { getFunctionName } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMachineRows } from './useMachineRows';
import type { UserMachine } from '../../../types/machine';

interface UsageRow {
  machineId: string;
  activeWorkspaceCount: number;
  activeChatroomCount: number;
  capped: boolean;
}

const mocks = vi.hoisted(() => ({
  registry: undefined as { machines: UserMachine[] } | undefined,
  connectivity: undefined as { machines: { machineId: string; connected: boolean }[] } | undefined,
  usage: undefined as { machines: UsageRow[] } | undefined,
  lastSeen: undefined as
    { machines: { machineId: string; lastSeenAt: number | null }[] } | undefined,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown) => {
    const name = getFunctionName(query as FunctionReference<'query'>);
    switch (name) {
      case 'machines:getUserMachines':
        return mocks.registry;
      case 'machines:listMachineConnectivity':
        return mocks.connectivity;
      case 'machines:getMachineUsage':
        return mocks.usage;
      case 'machines:listMachineLastSeen':
        return mocks.lastSeen;
      default:
        throw new Error(`Unexpected query: ${name}`);
    }
  },
}));

function machine(overrides: Partial<UserMachine> & { machineId: string }): UserMachine {
  return { hostname: 'host', os: 'darwin', registeredAt: 0, ...overrides };
}

const MACHINE_A = machine({ machineId: 'm-a', alias: 'Alpha', registeredAt: 1 });
const MACHINE_B = machine({ machineId: 'm-b', alias: 'bravo', registeredAt: 2 });
const MACHINE_C = machine({ machineId: 'm-c', hostname: 'Charlie', registeredAt: 3 });

describe('useMachineRows', () => {
  beforeEach(() => {
    mocks.registry = undefined;
    mocks.connectivity = undefined;
    mocks.usage = undefined;
    mocks.lastSeen = undefined;
  });

  it('reports loading from the registry query only', () => {
    const { result } = renderHook(() => useMachineRows());

    expect(result.current).toEqual({ rows: [], isLoading: true });
  });

  it('sorts rows by display name', () => {
    mocks.registry = { machines: [MACHINE_C, MACHINE_B, MACHINE_A] };

    const { result } = renderHook(() => useMachineRows());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.rows.map((row) => row.machine.machineId)).toEqual(['m-a', 'm-b', 'm-c']);
  });

  it('leaves connectivity undefined until it resolves, then reports the value', () => {
    mocks.registry = { machines: [MACHINE_A] };

    const { result, rerender } = renderHook(() => useMachineRows());

    expect(result.current.rows[0]!.connected).toBeUndefined();

    mocks.connectivity = { machines: [{ machineId: 'm-a', connected: false }] };
    rerender();

    expect(result.current.rows[0]!.connected).toBe(false);

    mocks.connectivity = { machines: [{ machineId: 'm-a', connected: true }] };
    rerender();

    expect(result.current.rows[0]!.connected).toBe(true);
  });

  it('keeps row order when connectivity flips', () => {
    mocks.registry = { machines: [MACHINE_C, MACHINE_B, MACHINE_A] };
    mocks.connectivity = { machines: [] };

    const { result, rerender } = renderHook(() => useMachineRows());
    const before = result.current.rows.map((row) => row.machine.machineId);

    mocks.connectivity = {
      machines: [
        { machineId: 'm-c', connected: true },
        { machineId: 'm-b', connected: true },
        { machineId: 'm-a', connected: false },
      ],
    };
    rerender();

    expect(result.current.rows.map((row) => row.machine.machineId)).toEqual(before);
  });

  it('attaches usage and last-seen to the matching machine', () => {
    mocks.registry = { machines: [MACHINE_A, MACHINE_B] };
    mocks.usage = {
      machines: [
        { machineId: 'm-b', activeWorkspaceCount: 3, activeChatroomCount: 2, capped: false },
      ],
    };
    mocks.lastSeen = { machines: [{ machineId: 'm-a', lastSeenAt: 1234 }] };

    const { result } = renderHook(() => useMachineRows());
    const [rowA, rowB] = result.current.rows;

    expect(rowA!.lastSeenAt).toBe(1234);
    expect(rowA!.usage).toBeUndefined();
    expect(rowB!.lastSeenAt).toBeUndefined();
    expect(rowB!.usage).toEqual({
      activeWorkspaceCount: 3,
      activeChatroomCount: 2,
      capped: false,
    });
  });
});
