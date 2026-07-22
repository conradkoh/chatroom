import { describe, it, expect, beforeEach } from 'vitest';

import { parseLocalConfig } from './parse-config.js';

const REPO = '/repo';

describe('parseLocalConfig', () => {
  beforeEach(() => {
    delete process.env.LOCAL_MANAGER_PORT;
    delete process.env.LOCAL_WEBAPP_PORT;
    delete process.env.LOCAL_CONVEX_PORT;
  });

  it('uses defaults when no flags or env', () => {
    const cfg = parseLocalConfig(REPO, ['node', 'cli.ts']);
    expect(cfg.managerPort).toBe(3847);
    expect(cfg.webappPort).toBe(3000);
    expect(cfg.convexPort).toBe(3210);
    expect(cfg.convexUrl).toBe('http://127.0.0.1:3210');
    expect(cfg.webappUrl).toBe('http://localhost:3000');
  });

  it('reads CLI flags', () => {
    const cfg = parseLocalConfig(REPO, [
      'node',
      'cli.ts',
      '--manager-port',
      '4000',
      '--webapp-port',
      '3001',
      '--convex-port',
      '3211',
    ]);
    expect(cfg.managerPort).toBe(4000);
    expect(cfg.webappPort).toBe(3001);
    expect(cfg.convexPort).toBe(3211);
  });

  it('reads env vars', () => {
    process.env.LOCAL_MANAGER_PORT = '4100';
    process.env.LOCAL_WEBAPP_PORT = '3100';
    process.env.LOCAL_CONVEX_PORT = '3310';
    const cfg = parseLocalConfig(REPO, ['node', 'cli.ts']);
    expect(cfg.managerPort).toBe(4100);
    expect(cfg.webappPort).toBe(3100);
    expect(cfg.convexPort).toBe(3310);
  });

  it('CLI flag overrides env var', () => {
    process.env.LOCAL_MANAGER_PORT = '4100';
    const cfg = parseLocalConfig(REPO, ['node', 'cli.ts', '--manager-port', '4200']);
    expect(cfg.managerPort).toBe(4200);
  });

  it('ignores invalid port values and uses fallback', () => {
    const cfg = parseLocalConfig(REPO, [
      'node',
      'cli.ts',
      '--manager-port',
      'abc',
      '--webapp-port',
      '0',
      '--convex-port',
      '70000',
    ]);
    expect(cfg.managerPort).toBe(3847);
    expect(cfg.webappPort).toBe(3000);
    expect(cfg.convexPort).toBe(3210);
  });
});
