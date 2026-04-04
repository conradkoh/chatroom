/**
 * Machine Access — Unit Tests
 */

import { describe, expect, it } from 'vitest';
import { verifyMachineOwnership, type MachineAccessDeps } from './machine-access';

describe('verifyMachineOwnership', () => {
  const mockDeps = (userId: string | null): MachineAccessDeps => ({
    getMachineByMachineId: async () =>
      userId ? { userId } : null,
  });

  it('returns true when user owns the machine', async () => {
    const deps = mockDeps('user-123');
    expect(await verifyMachineOwnership(deps, 'machine-1', 'user-123')).toBe(true);
  });

  it('returns false when user does not own the machine', async () => {
    const deps = mockDeps('user-456');
    expect(await verifyMachineOwnership(deps, 'machine-1', 'user-123')).toBe(false);
  });

  it('returns false when machine is not found', async () => {
    const deps = mockDeps(null);
    expect(await verifyMachineOwnership(deps, 'nonexistent', 'user-123')).toBe(false);
  });
});
