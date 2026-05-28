import { describe, expect, it } from 'vitest';

import type { AgentConfig } from '../types/machine';
import {
  shouldDeferInitUntilWorkspacesLoad,
  type AgentPreference,
} from './AgentConfigTabs';

function mkConfig(machineId: string, workingDir: string): AgentConfig {
  return {
    machineId,
    hostname: 'host',
    role: 'builder',
    agentType: 'cursor',
    availableHarnesses: ['cursor'],
    workingDir,
    updatedAt: 1,
  };
}

describe('shouldDeferInitUntilWorkspacesLoad', () => {
  it('defers when machine is selected and working dir may come from workspace registry', () => {
    expect(shouldDeferInitUntilWorkspacesLoad('m1', [], undefined)).toBe(true);
  });

  it('does not defer when role config already has working dir for the machine', () => {
    expect(shouldDeferInitUntilWorkspacesLoad('m1', [mkConfig('m1', '/from-config')], undefined)).toBe(
      false
    );
  });

  it('does not defer when preference has working dir for the machine', () => {
    const pref: AgentPreference = {
      role: 'builder',
      machineId: 'm1',
      agentHarness: 'cursor',
      workingDir: '/from-pref',
    };
    expect(shouldDeferInitUntilWorkspacesLoad('m1', [], pref)).toBe(false);
  });

  it('does not defer when no machine yet but role configs provide working dir', () => {
    expect(shouldDeferInitUntilWorkspacesLoad(null, [mkConfig('m1', '/fallback')], undefined)).toBe(
      false
    );
  });

  it('does not defer when preference has working dir without a selected machine', () => {
    const pref: AgentPreference = {
      role: 'builder',
      machineId: 'm1',
      agentHarness: 'cursor',
      workingDir: '/pref-only',
    };
    expect(shouldDeferInitUntilWorkspacesLoad(null, [], pref)).toBe(false);
  });
});
