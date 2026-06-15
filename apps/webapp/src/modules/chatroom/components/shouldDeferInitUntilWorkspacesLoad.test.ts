import { describe, expect, it } from 'vitest';

import { shouldDeferInitUntilWorkspacesLoad } from './AgentControls';
import type { AgentConfig } from '../types/machine';

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
    expect(shouldDeferInitUntilWorkspacesLoad('m1', [])).toBe(true);
  });

  it('does not defer when role config already has working dir for the machine', () => {
    expect(shouldDeferInitUntilWorkspacesLoad('m1', [mkConfig('m1', '/from-config')])).toBe(false);
  });

  it('does not defer when no machine yet but role configs provide working dir', () => {
    expect(shouldDeferInitUntilWorkspacesLoad(null, [mkConfig('m1', '/fallback')])).toBe(false);
  });

  it('does not defer when no machine and no role configs', () => {
    expect(shouldDeferInitUntilWorkspacesLoad(null, [])).toBe(false);
  });
});
