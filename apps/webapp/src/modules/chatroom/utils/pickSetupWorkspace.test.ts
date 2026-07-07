import { describe, expect, it } from 'vitest';

import { pickSetupWorkspace } from './pickSetupWorkspace';

describe('pickSetupWorkspace', () => {
  it('returns null for empty list', () => {
    expect(pickSetupWorkspace([])).toBeNull();
  });

  it('returns null when machineId or workingDir missing', () => {
    expect(pickSetupWorkspace([{ machineId: '', workingDir: '/a' }])).toBeNull();
    expect(pickSetupWorkspace([{ machineId: 'm1', workingDir: '' }])).toBeNull();
  });

  it('picks most recently registered workspace', () => {
    const result = pickSetupWorkspace([
      { machineId: 'm1', workingDir: '/old', registeredAt: 100 },
      { machineId: 'm2', workingDir: '/new', registeredAt: 200 },
    ]);
    expect(result).toEqual({ machineId: 'm2', workingDir: '/new' });
  });

  it('returns sole valid workspace', () => {
    expect(pickSetupWorkspace([{ machineId: 'm1', workingDir: '/code', registeredAt: 1 }])).toEqual(
      { machineId: 'm1', workingDir: '/code' }
    );
  });
});
