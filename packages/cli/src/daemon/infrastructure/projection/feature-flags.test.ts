import { afterEach, describe, expect, it } from 'vitest';
import { assertOrchestrationFlagCompatibility } from './feature-flags.js';

describe('assertOrchestrationFlagCompatibility', () => {
  const env = process.env;
  afterEach(() => {
    process.env = { ...env };
  });
  it('throws when P5 enabled without full cutover chain', () => {
    process.env.DAEMON_ORCHESTRATION_P5 = '1';
    process.env.DAEMON_ORCHESTRATION_P1 = '1';
    expect(() => assertOrchestrationFlagCompatibility()).toThrow(/P5 requires/);
  });
  it('no-ops when P5 disabled', () => {
    delete process.env.DAEMON_ORCHESTRATION_P5;
    expect(() => assertOrchestrationFlagCompatibility()).not.toThrow();
  });
});
