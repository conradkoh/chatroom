import { describe, expect, it } from 'vitest';

import { buildCarryOverPreview, type PreviewConfig } from './carryOverPreview';

const FROM = { machineId: 'm1', workingDir: '/code/app' };

const CONFIGS: PreviewConfig[] = [
  { role: 'planner', machineId: 'm1', workingDir: '/code/app', agentType: 'opencode' },
  { role: 'builder', machineId: 'm1', workingDir: '/code/app', agentType: 'cursor-sdk' },
];

describe('buildCarryOverPreview', () => {
  it('returns null when no config belongs to the current workspace', () => {
    const other = CONFIGS.map((config) => ({ ...config, machineId: 'm9' }));

    expect(buildCarryOverPreview(other, FROM, ['opencode', 'cursor-sdk'])).toBeNull();
  });

  it('splits expected from at-risk by target harnesses', () => {
    expect(buildCarryOverPreview(CONFIGS, FROM, ['cursor-sdk'])).toEqual({
      expected: ['builder'],
      atRisk: [{ role: 'planner', harness: 'opencode' }],
    });
  });

  it('counts every role as expected while capabilities load', () => {
    expect(buildCarryOverPreview(CONFIGS, FROM, null)).toEqual({
      expected: ['planner', 'builder'],
      atRisk: [],
    });
  });

  it('matches a config path with a trailing slash', () => {
    const trailing: PreviewConfig[] = [
      { role: 'planner', machineId: 'm1', workingDir: '/code/app/', agentType: 'opencode' },
    ];

    expect(buildCarryOverPreview(trailing, FROM, ['opencode'])).toEqual({
      expected: ['planner'],
      atRisk: [],
    });
  });
});
