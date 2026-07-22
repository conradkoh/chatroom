import { describe, it, expect, beforeEach } from 'vitest';

import { parseLocalConfig } from './parse-config.js';

const REPO = '/repo';

describe('parseLocalConfig', () => {
  beforeEach(() => {
    delete process.env.LOCAL_MANAGER_PORT;
  });

  it('uses default manager port when no flags or env', () => {
    const cfg = parseLocalConfig(REPO, ['node', 'cli.ts']);
    expect(cfg.managerPort).toBe(3847);
    expect(cfg.repoRoot).toBe(REPO);
  });

  it('reads CLI flag', () => {
    const cfg = parseLocalConfig(REPO, ['node', 'cli.ts', '--manager-port', '4000']);
    expect(cfg.managerPort).toBe(4000);
  });

  it('reads env var', () => {
    process.env.LOCAL_MANAGER_PORT = '4100';
    const cfg = parseLocalConfig(REPO, ['node', 'cli.ts']);
    expect(cfg.managerPort).toBe(4100);
  });

  it('CLI flag overrides env var', () => {
    process.env.LOCAL_MANAGER_PORT = '4100';
    const cfg = parseLocalConfig(REPO, ['node', 'cli.ts', '--manager-port', '4200']);
    expect(cfg.managerPort).toBe(4200);
  });

  it('ignores invalid manager port and uses fallback', () => {
    const cfg = parseLocalConfig(REPO, ['node', 'cli.ts', '--manager-port', 'abc']);
    expect(cfg.managerPort).toBe(3847);
  });
});
