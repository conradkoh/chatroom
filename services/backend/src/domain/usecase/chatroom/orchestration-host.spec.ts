import { describe, expect, it } from 'vitest';

import {
  OrchestrationHostConflict,
  assertSingleMachineWorkspace,
  hasOrchestrationHostConflict,
  listRemoteConfigs,
  resolveOrchestrationHost,
} from './orchestration-host';

function remoteConfig(overrides: { machineId?: string; workingDir?: string }) {
  return {
    type: 'remote' as const,
    machineId: overrides.machineId,
    workingDir: overrides.workingDir,
  };
}

function customConfig() {
  return { type: 'custom' as const, machineId: undefined, workingDir: undefined };
}

describe('orchestration-host', () => {
  describe('resolveOrchestrationHost', () => {
    it('resolves host when all remote configs share machine + workingDir', () => {
      const configs = [
        remoteConfig({ machineId: 'machine-a', workingDir: '/ws' }),
        remoteConfig({ machineId: 'machine-a', workingDir: '/ws' }),
      ];
      expect(resolveOrchestrationHost(configs)).toEqual({
        machineId: 'machine-a',
        workingDir: '/ws',
      });
    });

    it('returns null when there are no remote configs', () => {
      expect(resolveOrchestrationHost([])).toBeNull();
      expect(resolveOrchestrationHost([customConfig()])).toBeNull();
    });

    it('returns null when remote configs disagree on machine', () => {
      const configs = [
        remoteConfig({ machineId: 'machine-a', workingDir: '/ws' }),
        remoteConfig({ machineId: 'machine-b', workingDir: '/ws' }),
      ];
      expect(resolveOrchestrationHost(configs)).toBeNull();
    });

    it('returns null when remote configs disagree on workingDir', () => {
      const configs = [
        remoteConfig({ machineId: 'machine-a', workingDir: '/ws' }),
        remoteConfig({ machineId: 'machine-a', workingDir: '/other' }),
      ];
      expect(resolveOrchestrationHost(configs)).toBeNull();
    });

    it('ignores custom configs during resolution', () => {
      const configs = [remoteConfig({ machineId: 'machine-a', workingDir: '/ws' }), customConfig()];
      expect(resolveOrchestrationHost(configs)).toEqual({
        machineId: 'machine-a',
        workingDir: '/ws',
      });
    });
  });

  describe('hasOrchestrationHostConflict / assertSingleMachineWorkspace', () => {
    it('reports no conflict for a single remote config', () => {
      expect(
        hasOrchestrationHostConflict([remoteConfig({ machineId: 'a', workingDir: '/ws' })])
      ).toBe(false);
      expect(() =>
        assertSingleMachineWorkspace([remoteConfig({ machineId: 'a', workingDir: '/ws' })])
      ).not.toThrow();
    });

    it('reports no conflict when multiple remotes share machine + workingDir', () => {
      const configs = [
        remoteConfig({ machineId: 'a', workingDir: '/ws' }),
        remoteConfig({ machineId: 'a', workingDir: '/ws' }),
      ];
      expect(hasOrchestrationHostConflict(configs)).toBe(false);
    });

    it('reports conflict when remote configs are on different machines', () => {
      const configs = [
        remoteConfig({ machineId: 'a', workingDir: '/ws' }),
        remoteConfig({ machineId: 'b', workingDir: '/ws' }),
      ];
      expect(hasOrchestrationHostConflict(configs)).toBe(true);
      expect(() => assertSingleMachineWorkspace(configs)).toThrow(OrchestrationHostConflict);
    });

    it('reports conflict when remote configs have different working dirs', () => {
      const configs = [
        remoteConfig({ machineId: 'a', workingDir: '/ws' }),
        remoteConfig({ machineId: 'a', workingDir: '/other' }),
      ];
      expect(hasOrchestrationHostConflict(configs)).toBe(true);
      expect(() => assertSingleMachineWorkspace(configs)).toThrow(OrchestrationHostConflict);
    });

    it('reports no conflict for empty or custom-only configs', () => {
      expect(hasOrchestrationHostConflict([])).toBe(false);
      expect(hasOrchestrationHostConflict([customConfig()])).toBe(false);
    });
  });

  it('listRemoteConfigs filters custom configs', () => {
    const configs = [remoteConfig({ machineId: 'a', workingDir: '/ws' }), customConfig()];
    expect(listRemoteConfigs(configs)).toHaveLength(1);
  });
});
