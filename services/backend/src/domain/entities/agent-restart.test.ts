import { describe, expect, it } from 'vitest';

import { isRunnableRemoteTeamConfig } from './agent-restart';

const complete = {
  type: 'remote',
  machineId: 'machine',
  agentHarness: 'cursor-sdk' as const,
  model: 'model',
  workingDir: '/workspace',
};

describe('isRunnableRemoteTeamConfig', () => {
  it('accepts a complete remote config', () => {
    expect(isRunnableRemoteTeamConfig(complete)).toBe(true);
  });

  it('rejects incomplete remote configs', () => {
    expect(isRunnableRemoteTeamConfig({ ...complete, model: undefined })).toBe(false);
  });

  it('rejects non-remote configs', () => {
    expect(isRunnableRemoteTeamConfig({ ...complete, type: 'custom' })).toBe(false);
  });
});
