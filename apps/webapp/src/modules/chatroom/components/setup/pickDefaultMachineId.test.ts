import { describe, expect, it } from 'vitest';

import { pickDefaultMachineId } from './pickDefaultMachineId';

const A = { machineId: 'machine-a' };
const B = { machineId: 'machine-b' };

describe('pickDefaultMachineId', () => {
  it('returns the chosen machine when one is set, even if other machines are connected', () => {
    expect(pickDefaultMachineId([A, B], 'machine-b')).toBe('machine-b');
  });

  it('returns the only connected machine when nothing is chosen', () => {
    expect(pickDefaultMachineId([A], null)).toBe('machine-a');
  });

  it('returns null when no machine is connected', () => {
    expect(pickDefaultMachineId([], null)).toBeNull();
  });

  it('returns null when several machines are connected and none is chosen', () => {
    expect(pickDefaultMachineId([A, B], null)).toBeNull();
  });
});
