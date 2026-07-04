import { describe, expect, it } from 'vitest';

import {
  isAlwaysExcludedDirName,
  isPathContentReadable,
  isPathVisible,
  isSecretPath,
} from './workspace-visibility-policy.js';

describe('workspace-visibility-policy', () => {
  it('identifies always-excluded directory names', () => {
    expect(isAlwaysExcludedDirName('node_modules')).toBe(true);
    expect(isAlwaysExcludedDirName('.git')).toBe(true);
    expect(isAlwaysExcludedDirName('src')).toBe(false);
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
  });

  it('hides generated and cache paths from listings', () => {
    expect(isPathVisible('convex/_generated/api.js')).toBe(false);
    expect(isPathVisible('.turbo/cache/foo')).toBe(false);
    expect(isPathVisible('.next/cache/webpack.json')).toBe(false);
    expect(isPathVisible('.vercel/output/foo')).toBe(false);
  });

  it('blocks secret file content reads', () => {
    expect(isPathContentReadable('README.md')).toBe(true);
    expect(isPathContentReadable('.env')).toBe(false);
    expect(isPathContentReadable('secrets/token.txt')).toBe(false);
  });
});
