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

  it('unknown target (null): no at-risk and no expected claim', () => {
    expect(buildCarryOverPreview(CONFIGS, FROM, null)).toEqual({
      targetReported: false,
      expected: [],
      atRisk: [],
    });
  });

  it('reported list with missing harnesses: splits expected from at-risk', () => {
    expect(buildCarryOverPreview(CONFIGS, FROM, ['cursor-sdk'])).toEqual({
      targetReported: true,
      expected: ['builder'],
      atRisk: [{ role: 'planner', harness: 'opencode' }],
    });
  });

  it('reported empty list: every role at risk, and distinct from unknown', () => {
    expect(buildCarryOverPreview(CONFIGS, FROM, [])).toEqual({
      targetReported: true,
      expected: [],
      atRisk: [
        { role: 'planner', harness: 'opencode' },
        { role: 'builder', harness: 'cursor-sdk' },
      ],
    });
  });

  it('matches a config path with a trailing slash', () => {
    const trailing: PreviewConfig[] = [
      { role: 'planner', machineId: 'm1', workingDir: '/code/app/', agentType: 'opencode' },
    ];
    expect(buildCarryOverPreview(trailing, FROM, ['opencode'])).toEqual({
      targetReported: true,
      expected: ['planner'],
      atRisk: [],
    });
  });
});
