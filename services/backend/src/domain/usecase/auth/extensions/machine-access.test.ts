import { describe, it, expect } from 'vitest';
import {
  checkMachineOwnership,
  type CheckMachineOwnershipDeps,
} from './machine-access';

function createMockDeps(overrides: Partial<CheckMachineOwnershipDeps> = {}): CheckMachineOwnershipDeps {
  return {
    getMachineByMachineId: async () => null,
    ...overrides,
  };
}

describe('checkMachineOwnership', () => {
  it('returns ok when user owns the machine', async () => {
    const deps = createMockDeps({
      getMachineByMachineId: async () => ({ userId: 'user-1' }),
    });

    const result = await checkMachineOwnership(deps, 'machine-1', 'user-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.machineId).toBe('machine-1');
      expect(result.userId).toBe('user-1');
    }
  });

  it('returns not ok when user does not own the machine', async () => {
    const deps = createMockDeps({
      getMachineByMachineId: async () => ({ userId: 'other-user' }),
    });

    const result = await checkMachineOwnership(deps, 'machine-1', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('Access denied');
    }
  });

  it('returns not ok when machine not found', async () => {
    const deps = createMockDeps();

    const result = await checkMachineOwnership(deps, 'nonexistent', 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('Machine not found');
    }
  });
});
