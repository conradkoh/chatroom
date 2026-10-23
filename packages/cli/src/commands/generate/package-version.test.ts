/**
 * Installed package version lookup tests.
 *
 * Exercises real resolution against installed packages; no network or mocks.
 */

import { describe, expect, it } from 'vitest';

import { readInstalledPackageVersion } from './package-version.js';

describe('readInstalledPackageVersion', () => {
  it('returns the installed version for a resolvable package', () => {
    expect(readInstalledPackageVersion('pngjs')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns unknown for an unresolvable specifier', () => {
    expect(readInstalledPackageVersion('@chatroom-test/does-not-exist')).toBe('unknown');
  });
});
