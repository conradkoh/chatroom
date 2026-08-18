import { describe, expect, it } from 'vitest';

import {
  classifyDirectorySyncMode,
  isAlwaysExcludedDirName,
  isPathContentReadable,
  isPathVisible,
  isSecretPath,
} from './workspace-visibility-policy.js';

describe('workspace-visibility-policy', () => {
  it('identifies always-excluded directory names', () => {
    expect(isAlwaysExcludedDirName('node_modules')).toBe(true);
    expect(isAlwaysExcludedDirName('.git')).toBe(true);
    expect(isAlwaysExcludedDirName('.nx')).toBe(true);
    expect(isAlwaysExcludedDirName('.convex')).toBe(true);
    expect(isAlwaysExcludedDirName('src')).toBe(false);
    expect(isAlwaysExcludedDirName('.gdp')).toBe(false);
  });

  it('classifies directories using known and heuristic signals', () => {
    expect(
      classifyDirectorySyncMode('.nx', {
        relativePath: '.nx',
        immediateSiblingCount: 10,
        immediateChildCount: 20,
      })
    ).toBe('shallow');
    expect(
      classifyDirectorySyncMode('.convex', {
        relativePath: 'services/backend/.convex',
        immediateSiblingCount: 10,
        immediateChildCount: 20,
      })
    ).toBe('shallow');
    expect(
      classifyDirectorySyncMode('.gdp', {
        relativePath: '.gdp',
        immediateSiblingCount: 10,
        immediateChildCount: 4,
      })
    ).toBe('full');
    expect(
      classifyDirectorySyncMode('vendor', {
        relativePath: 'vendor',
        immediateSiblingCount: 10,
        immediateChildCount: 600,
      })
    ).toBe('shallow');
  });

  it('identifies secret paths', () => {
    expect(isSecretPath('.env')).toBe(true);
    expect(isSecretPath('.env.local')).toBe(true);
    expect(isSecretPath('certs/server.pem')).toBe(true);
    expect(isSecretPath('secrets/api.key')).toBe(true);
    expect(isSecretPath('.aws/credentials')).toBe(true);
    expect(isSecretPath('src/index.ts')).toBe(false);
  });

  it('hides secret and excluded paths from listings', () => {
    expect(isPathVisible('src/app.ts')).toBe(true);
    expect(isPathVisible('.env')).toBe(false);
    expect(isPathVisible('node_modules/pkg/index.js')).toBe(false);
    expect(isPathVisible('dist/bundle.js')).toBe(false);
    expect(isPathVisible('.gdp/config/app.json')).toBe(true);
    expect(isPathVisible('.drone.yml')).toBe(true);
  });

  it('shows shallow directory stubs but hides their descendants', () => {
    expect(isPathVisible('node_modules')).toBe(true);
    expect(isPathVisible('dist')).toBe(true);
    expect(isPathVisible('.next')).toBe(true);
    expect(isPathVisible('node_modules/pkg/index.js')).toBe(false);
    expect(isPathVisible('dist/bundle.js')).toBe(false);
    expect(isPathVisible('.next/cache/webpack.json')).toBe(false);
    expect(isPathVisible('.nx/cache/abc.json')).toBe(false);
    expect(isPathVisible('services/backend/.convex/local/config.json')).toBe(false);
  });

  it('blocks secret file content reads', () => {
    expect(isPathContentReadable('README.md')).toBe(true);
    expect(isPathContentReadable('.env')).toBe(false);
    expect(isPathContentReadable('secrets/token.txt')).toBe(false);
  });
});
