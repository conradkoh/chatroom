import { describe, expect, it } from 'vitest';

import { deriveInitialResumeSession } from './AgentControls';
import type { AgentConfig } from '../types/machine';

function mkConfig(machineId: string, wantResume: boolean | undefined, updatedAt = 1): AgentConfig {
  return {
    machineId,
    hostname: 'host',
    role: 'builder',
    agentType: 'cursor',
    availableHarnesses: ['cursor'],
    workingDir: '/w',
    updatedAt,
    ...(wantResume !== undefined ? { wantResume } : {}),
  };
}

describe('deriveInitialResumeSession', () => {
  it('uses the running agent config wantResume when present (authoritative)', () => {
    const running = mkConfig('m1', false);
    expect(deriveInitialResumeSession('m1', [running], running)).toBe(false);
  });

  it('seeds from the persisted config for the chosen machine when stopped (last started with false)', () => {
    // No running agent (stopped-on-load); persisted config remembers false.
    expect(deriveInitialResumeSession('m1', [mkConfig('m1', false)], undefined)).toBe(false);
  });

  it('seeds true from the persisted config for the chosen machine', () => {
    expect(deriveInitialResumeSession('m1', [mkConfig('m1', true)], undefined)).toBe(true);
  });

  it('prefers the chosen-machine config over other role configs', () => {
    const configs = [mkConfig('m1', false, 2), mkConfig('m2', true, 5)];
    expect(deriveInitialResumeSession('m1', configs, undefined)).toBe(false);
  });

  it('falls back to the most-recently-updated config when no machine is chosen', () => {
    const configs = [mkConfig('m1', true, 1), mkConfig('m2', false, 9)];
    expect(deriveInitialResumeSession(null, configs, undefined)).toBe(false);
  });

  it('defaults to true only when no persisted wantResume exists anywhere (new start)', () => {
    expect(deriveInitialResumeSession('m1', [mkConfig('m1', undefined)], undefined)).toBe(true);
    expect(deriveInitialResumeSession(null, [], undefined)).toBe(true);
  });

  it('does not let a present-but-false value get masked by the default', () => {
    // Regression guard: false must survive, never coerced to the true default.
    const configs = [mkConfig('m1', false)];
    expect(deriveInitialResumeSession('m1', configs, undefined)).not.toBe(true);
  });
});
