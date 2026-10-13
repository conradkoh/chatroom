import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'bun:test';

import {
  bumpMinorAndSyncAll,
  bumpMinorVersion,
  parseSemver,
  syncAllPackageVersions,
  WORKSPACE_PACKAGE_JSON_RELATIVE_PATHS,
} from './package-versions';

function createPackages(rootVersion = '0.0.0'): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'pkg-versions-'));
  for (const rel of WORKSPACE_PACKAGE_JSON_RELATIVE_PATHS) {
    const path = join(repoRoot, rel);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ name: 'test', version: rel === 'package.json' ? rootVersion : '0.0.0' })
    );
  }
  return repoRoot;
}

describe('package-versions', () => {
  it('parses and bumps valid versions', () => {
    expect(parseSemver('1.1.0')).toEqual({ major: 1, minor: 1, patch: 0 });
    expect(bumpMinorVersion('1.1.0')).toBe('1.2.0');
    expect(bumpMinorVersion('1.2.9')).toBe('1.3.0');
  });

  it('syncs all workspace package versions', () => {
    const repoRoot = createPackages();
    try {
      syncAllPackageVersions(repoRoot, '2.0.0');
      for (const rel of WORKSPACE_PACKAGE_JSON_RELATIVE_PATHS) {
        expect(JSON.parse(readFileSync(join(repoRoot, rel), 'utf8')).version).toBe('2.0.0');
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  it('bumps from root and syncs all packages', () => {
    const repoRoot = createPackages('1.1.0');
    try {
      expect(bumpMinorAndSyncAll(repoRoot)).toBe('1.2.0');
      for (const rel of WORKSPACE_PACKAGE_JSON_RELATIVE_PATHS) {
        expect(JSON.parse(readFileSync(join(repoRoot, rel), 'utf8')).version).toBe('1.2.0');
      }
    } finally {
      rmSync(repoRoot, { recursive: true, force: true });
    }
  });
});
