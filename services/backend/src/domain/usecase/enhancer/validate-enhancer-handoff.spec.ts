import { describe, expect, test } from 'vitest';
import { validateEnhancerHandoff } from './validate-enhancer-handoff';

const config = { type: 'remote', enabled: true, machineId: 'm', model: 'model', agentHarness: 'opencode', workingDir: '/tmp' } as any;
describe('validateEnhancerHandoff', () => {
  test('honors false, true, and live snapshots', () => {
    expect(validateEnhancerHandoff({ taskPlannerEnhancerEnabled: false, config }).code).toBe('ENHANCER_NOT_ENABLED');
    expect(validateEnhancerHandoff({ taskPlannerEnhancerEnabled: true, config }).allowed).toBe(true);
    expect(validateEnhancerHandoff({ config }).allowed).toBe(true);
  });
  test('rejects incomplete enabled configuration', () => {
    expect(validateEnhancerHandoff({ taskPlannerEnhancerEnabled: true, config: { ...config, workingDir: undefined } as any }).code).toBe('ENHANCER_CONFIG_INCOMPLETE');
  });
});
