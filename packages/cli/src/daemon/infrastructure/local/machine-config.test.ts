import { describe, expect, it, vi } from 'vitest';

import { createMachineConfigPort } from './machine-config.js';
import * as storage from '../../../infrastructure/machine/storage.js';
import type { MachineConfig } from '../../../infrastructure/machine/types.js';

vi.mock('../../../infrastructure/machine/storage.js', () => ({
  loadMachineConfig: vi.fn(),
  ensureMachineRegistered: vi.fn(),
  getMachineId: vi.fn(),
  getMachineConfigPath: vi.fn(() => '/mock/machine.json'),
}));

describe('createMachineConfigPort', () => {
  it('delegates loadMachineConfig to storage', async () => {
    const config = { machineId: 'm1', hostname: 'host' } as MachineConfig;
    vi.mocked(storage.loadMachineConfig).mockResolvedValue(config);

    const port = createMachineConfigPort();
    await expect(port.loadMachineConfig()).resolves.toBe(config);
    expect(storage.loadMachineConfig).toHaveBeenCalledOnce();
  });

  it('delegates ensureMachineRegistered to storage', async () => {
    const info = {
      machineId: 'm1',
      hostname: 'host',
      os: 'darwin',
      availableHarnesses: [],
      harnessVersions: {},
    };
    vi.mocked(storage.ensureMachineRegistered).mockResolvedValue(info);

    const port = createMachineConfigPort();
    await expect(port.ensureMachineRegistered({ allowCreate: true })).resolves.toBe(info);
    expect(storage.ensureMachineRegistered).toHaveBeenCalledWith({ allowCreate: true });
  });

  it('delegates getMachineId and getMachineConfigPath to storage', async () => {
    vi.mocked(storage.getMachineId).mockResolvedValue('machine-1');

    const port = createMachineConfigPort();
    await expect(port.getMachineId()).resolves.toBe('machine-1');
    expect(port.getMachineConfigPath()).toBe('/mock/machine.json');
  });
});
