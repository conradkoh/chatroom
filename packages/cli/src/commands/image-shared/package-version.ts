/**
 * Installed package version lookup.
 *
 * Manifests record the version of the third-party package they actually used.
 * Resolving the entry point (rather than importing `<pkg>/package.json`) works
 * for packages whose `exports` map only exposes specific subpaths. A broken
 * install must never break generation, so any failure records `unknown`.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const UNKNOWN_VERSION = 'unknown';

/** Read an installed package's version from its own package.json; 'unknown' on any failure. */
export function readInstalledPackageVersion(specifier: string): string {
  try {
    const require = createRequire(import.meta.url);
    const entryPath = require.resolve(specifier);
    const packageJsonPath = join(dirname(entryPath), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : UNKNOWN_VERSION;
  } catch {
    return UNKNOWN_VERSION;
  }
}
