import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Boundary guard: the browser must read the backend's signup decision from `api.appinfo.get`.
 * It must never recompute it from server env through the env-bound helpers in
 * `@workspace/backend/config/{featureFlags,signupMethods}`.
 */

const SRC_ROOT = path.resolve(__dirname, '../..');

const FORBIDDEN_IMPORTS = new Set([
  'isSignupAllowed',
  'isSelfSignupAllowed',
  'isInviteSignupAllowed',
  'getAllowedSignupMethods',
  'allowedSignupMethods',
]);

const BACKEND_CONFIG_IMPORT =
  /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@workspace\/backend\/config\/(?:featureFlags|signupMethods)['"]/g;

const FORBIDDEN_PROPERTY_READ = /\bfeatureFlags\.allowedSignupMethods\b/;

/** Returns the forbidden names a source file imports from, or reads off, the env-bound config. */
function findBoundaryViolations(source: string): string[] {
  const violations: string[] = [];
  for (const match of source.matchAll(BACKEND_CONFIG_IMPORT)) {
    const names = match[1].split(',').map(
      (part) =>
        part
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+/)[0]
    );
    violations.push(...names.filter((name) => FORBIDDEN_IMPORTS.has(name)));
  }
  if (FORBIDDEN_PROPERTY_READ.test(source)) {
    violations.push('featureFlags.allowedSignupMethods');
  }
  return violations;
}

function listNonTestSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listNonTestSources(fullPath);
    const isSource = /\.(ts|tsx)$/.test(entry.name);
    const isTest = /\.(test|spec)\.(ts|tsx)$/.test(entry.name);
    return isSource && !isTest ? [fullPath] : [];
  });
}

describe('signup config boundary', () => {
  it('flags env-bound signup helpers imported from the backend config', () => {
    expect(
      findBoundaryViolations(
        "import { isSignupAllowed } from '@workspace/backend/config/signupMethods';"
      )
    ).toEqual(['isSignupAllowed']);

    expect(
      findBoundaryViolations(
        "import {\n  type SignupMethod,\n  getAllowedSignupMethods,\n} from '@workspace/backend/config/signupMethods';"
      )
    ).toEqual(['getAllowedSignupMethods']);

    expect(findBoundaryViolations('const m = featureFlags.allowedSignupMethods;')).toEqual([
      'featureFlags.allowedSignupMethods',
    ]);
  });

  it('allows the static disableLogin flag and the backend signup types', () => {
    expect(
      findBoundaryViolations(
        "import { featureFlags } from '@workspace/backend/config/featureFlags';\nconst off = featureFlags.disableLogin;"
      )
    ).toEqual([]);

    expect(
      findBoundaryViolations(
        "import type { SignupMethod } from '@workspace/backend/config/signupMethods';"
      )
    ).toEqual([]);
  });

  it('no non-test webapp source imports the env-bound signup helpers', () => {
    const files = listNonTestSources(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders = files.flatMap((file) =>
      findBoundaryViolations(readFileSync(file, 'utf-8')).map(
        (name) => `${path.relative(SRC_ROOT, file)}: ${name}`
      )
    );
    expect(offenders).toEqual([]);
  });
});
