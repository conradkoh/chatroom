import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { loadSavedRuntimeConfig, saveSavedRuntimeConfig } from './saved-runtime-config.js';
import type { RuntimeConfig } from '../shared/protocol.js';

let tmpDir: string;

const sampleConfig: RuntimeConfig = {
  webappPort: 6249,
  convexBackendMode: 'hosted',
  convexPort: 3210,
  convexUrl: 'https://test-123.convex.cloud',
};

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'local-dev-saved-config-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('saved-runtime-config', () => {
  it('returns null when no saved config exists', () => {
    expect(loadSavedRuntimeConfig(tmpDir)).toBeNull();
  });

  it('saves and loads runtime config', () => {
    saveSavedRuntimeConfig(tmpDir, sampleConfig);
    expect(loadSavedRuntimeConfig(tmpDir)).toEqual(sampleConfig);
  });

  it('writes config under .local-dev/config.json', () => {
    saveSavedRuntimeConfig(tmpDir, sampleConfig);
    const path = join(tmpDir, '.local-dev', 'config.json');
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    expect(parsed).toEqual(sampleConfig);
  });

  it('ignores invalid saved config', () => {
    saveSavedRuntimeConfig(tmpDir, {
      ...sampleConfig,
      webappPort: 80,
    });
    expect(loadSavedRuntimeConfig(tmpDir)).toBeNull();
  });
});
