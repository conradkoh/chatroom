import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Workspace package.json paths relative to repo root. Root is SSOT for version reads. */
export const WORKSPACE_PACKAGE_JSON_RELATIVE_PATHS = [
  'package.json',
  'services/backend/package.json',
  'packages/shared/package.json',
  'apps/webapp/package.json',
] as const;

export const ROOT_PACKAGE_JSON_RELATIVE_PATH = 'package.json' as const;

type PackageJson = { version?: string; [key: string]: unknown };

export function parseSemver(version: string): { major: number; minor: number; patch: number } {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Invalid semver version: ${version}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

export function bumpMinorVersion(version: string): string {
  const { major, minor } = parseSemver(version);
  return `${major}.${minor + 1}.0`;
}

export function readPackageJson(repoRoot: string, relativePath: string): PackageJson {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), 'utf8')) as PackageJson;
}

export function writePackageJson(repoRoot: string, relativePath: string, pkg: PackageJson): void {
  writeFileSync(join(repoRoot, relativePath), `${JSON.stringify(pkg, null, 2)}\n`);
}

export function readRootVersion(repoRoot: string): string {
  const version = readPackageJson(repoRoot, ROOT_PACKAGE_JSON_RELATIVE_PATH).version;
  if (!version) throw new Error('Root package.json is missing a version field');
  return version;
}

export function syncAllPackageVersions(repoRoot: string, version: string): void {
  for (const relativePath of WORKSPACE_PACKAGE_JSON_RELATIVE_PATHS) {
    const pkg = readPackageJson(repoRoot, relativePath);
    pkg.version = version;
    writePackageJson(repoRoot, relativePath, pkg);
  }
}

/** Reads root version, bumps minor, and syncs all workspace package.json files. */
export function bumpMinorAndSyncAll(repoRoot: string): string {
  const next = bumpMinorVersion(readRootVersion(repoRoot));
  syncAllPackageVersions(repoRoot, next);
  return next;
}
