import { describe, expect, it } from 'vitest';

import type { AgentConfig } from '../types/machine';
import type { Workspace } from '../types/workspace';
import { deriveInitialWorkingDir, type AgentPreference } from './AgentConfigTabs';

function mkConfig(
  machineId: string,
  workingDir: string,
  updatedAt = 1
): AgentConfig {
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
        {
          role: 'builder',
          machineId: 'm1',
          agentHarness: 'cursor',
          workingDir: '/from-pref',
        },
        [mkWorkspace('m1', '/from-workspace')]
      );
      expect(result).toBe('/from-config');
    });

    it('uses preference.workingDir for the same machine over workspace registry', () => {
      const pref: AgentPreference = {
        role: 'builder',
        machineId: 'm1',
        agentHarness: 'cursor',
        workingDir: '/from-pref',
      };
      const result = deriveInitialWorkingDir(
        'm1',
        [mkConfig('m1', '')],
        pref,
        [mkWorkspace('m1', '/from-workspace')]
      );
      expect(result).toBe('/from-pref');
    });

    it('uses chatroomWorkspaces entry when config and preference have no working dir', () => {
      const result = deriveInitialWorkingDir(
        'm1',
        [mkConfig('m1', '')],
        undefined,
        [mkWorkspace('m1', '/from-workspace')]
      );
      expect(result).toBe('/from-workspace');
    });
  });

  describe('fallbacks when machineId is not set', () => {
    it('uses latest roleConfig workingDir by updatedAt', () => {
      const result = deriveInitialWorkingDir(
        null,
        [
          mkConfig('m1', '/older', 1),
          mkConfig('m2', '/newer', 10),
        ],
        undefined
      );
      expect(result).toBe('/newer');
    });

    it('uses preference.workingDir when no machine and no role configs', () => {
      const pref: AgentPreference = {
        role: 'builder',
        machineId: 'm1',
        agentHarness: 'cursor',
        workingDir: '/pref-only',
      };
      const result = deriveInitialWorkingDir(null, [], pref);
      expect(result).toBe('/pref-only');
    });
  });
});
