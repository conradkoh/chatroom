import { describe, expect, it } from 'vitest';

import { deriveInitialWorkingDir } from './AgentControls';
import type { AgentConfig } from '../types/machine';
import type { Workspace } from '../types/workspace';

function mkConfig(machineId: string, workingDir: string, updatedAt = 1): AgentConfig {
  return {
    machineId,
    hostname: 'host',
    role: 'builder',
    agentType: 'cursor',
    availableHarnesses: ['cursor'],
    workingDir,
    updatedAt,
  };
}

function mkWorkspace(machineId: string, workingDir: string): Workspace {
  return {
    id: `${machineId}::${workingDir}`,
    machineId,
    hostname: 'host',
    workingDir,
    agentRoles: ['builder'],
  };
}

describe('deriveInitialWorkingDir', () => {
  describe('when machineId is set', () => {
    it('uses roleConfig.workingDir for the machine when present', () => {
      const result = deriveInitialWorkingDir(
        'm1',
        [mkConfig('m1', '/from-config')],
        [mkWorkspace('m1', '/from-workspace')]
      );
      expect(result).toBe('/from-config');
    });

    it('uses chatroomWorkspaces entry when config has no working dir', () => {
      const result = deriveInitialWorkingDir(
        'm1',
        [mkConfig('m1', '')],
        [mkWorkspace('m1', '/from-workspace')]
      );
      expect(result).toBe('/from-workspace');
    });
  });

  describe('fallbacks when machineId is not set', () => {
    it('uses latest roleConfig workingDir by updatedAt', () => {
      const result = deriveInitialWorkingDir(null, [
        mkConfig('m1', '/older', 1),
        mkConfig('m2', '/newer', 10),
      ]);
      expect(result).toBe('/newer');
    });

    it('returns empty string when no machine and no role configs', () => {
      const result = deriveInitialWorkingDir(null, []);
      expect(result).toBe('');
    });
  });
});
