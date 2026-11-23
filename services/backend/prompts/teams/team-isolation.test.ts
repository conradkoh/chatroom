import fs from 'node:fs';
import path from 'node:path';

import ts from 'typescript';
import { describe, expect, test } from 'vitest';

/**
 * Import-boundary guard for per-team prompt code (isolation invariant, architect design jd71fhrgmfrqb0nngfqyd7jgb18jpadr).
 *
 * Rule 1: a file under prompts/teams/<T>/ must not import a file under prompts/teams/<U>/ (U !== T).
 * Rule 2: a file outside prompts/teams/ may reach team code only through prompts/teams/registry.ts or a pinned ALLOWED_TEAM_IMPORTS entry.
 * Rule 2 exempts test and typecheck files (*.test.ts, *.spec.ts, *.typecheck.ts): they exercise team code directly. Rule 1 still applies to them.
 *
 * Parsed: static import and export-from, import type, import() and require() with a string literal, import("...") types.
 * Specifiers: relative (./, ../) and @workspace/backend/ alias.
 * Not caught: computed specifiers, require.resolve, vi.mock path strings, import.meta.glob, and transitive reach through an
 * allowlisted module (the pinned entry is the boundary). Comments and string contents are never treated as imports.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BACKEND_PREFIX = 'services/backend/';
const BACKEND_ALIAS = '@workspace/backend/';
const TEAMS = `${BACKEND_PREFIX}prompts/teams/`;
const REGISTRY = `${TEAMS}registry.ts`;

interface AllowedTeamImport {
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

interface ImportSite {
  readonly from: string;
  readonly specifier: string;
  readonly to: string;
}

interface BoundaryReport {
  /** A team folder imports another team folder. */
  readonly crossTeam: readonly string[];
  /** A file outside prompts/teams imports team code that is neither the registry nor pinned. */
  readonly unlisted: readonly string[];
  /** A pinned entry that matches no import site. */
  readonly stale: readonly string[];
}

/**
 * Production outside-to-team import sites, one pinned (importer, target) pair per line.
 * Test and typecheck files are exempt from rule 2 and are never pinned here.
 * A pin that matches no production import site fails as stale.
 */
// One pinned pair per line keeps review diffs readable.
// prettier-ignore
const ALLOWED_TEAM_IMPORTS: readonly AllowedTeamImport[] = [
  { from: 'services/backend/prompts/cli/handoff-templates/index.ts', to: 'services/backend/prompts/teams/duo/handoff-templates/index.ts', reason: 'CLI handoff listing aggregates the duo role contracts' },
  { from: 'services/backend/prompts/cli/handoff-templates/index.ts', to: 'services/backend/prompts/teams/solo/handoff-templates/index.ts', reason: 'CLI handoff listing aggregates the solo role contracts' },
  { from: 'services/backend/prompts/cli/handoff-templates/index.ts', to: 'services/backend/prompts/teams/trio/handoff-templates/index.ts', reason: 'CLI handoff listing aggregates the trio role contracts' },
  { from: 'services/backend/prompts/cli/roles/fromContext.ts', to: 'services/backend/prompts/teams/solo/prompts/fromContext.ts', reason: 'documented exception, not fixed: the base role-guidance table maps the builtin role solo to solo guidance for rooms outside a preset team; removing it changes behaviour for those rooms and needs its own snapshot-backed decision' },
  { from: 'services/backend/prompts/cli/roles/game-asset-designer.ts', to: 'services/backend/prompts/teams/game-asset-designer-evidence.ts', reason: 'shared specialist body uses cross-team game-asset evidence rules' },
  { from: 'services/backend/prompts/cli/roles/game-asset-designer.ts', to: 'services/backend/prompts/teams/game-asset-designer-workflow.ts', reason: 'shared specialist body uses cross-team game-asset workflow rules' },
  { from: 'services/backend/prompts/cli/roles/verifier.ts', to: 'services/backend/prompts/teams/verifier-handoff-templates.ts', reason: 'shared specialist body uses the cross-team verifier gate vocabulary' },
  { from: 'services/backend/prompts/index.ts', to: 'services/backend/prompts/teams/index.ts', reason: 'package barrel re-exports duo team config and guidance' },
  { from: 'services/backend/prompts/task-delivery/verifier-gate-guidance.ts', to: 'services/backend/prompts/teams/verifier-handoff-templates.ts', reason: 'verifier gate text derives tokens from the shared verdict vocabulary' },
  { from: 'services/backend/prompts/utils/proof-of-verification.ts', to: 'services/backend/prompts/teams/verifier-handoff-templates.ts', reason: 'proof-of-verification derives tokens from the shared verdict vocabulary' },
];

const pairKey = (from: string, to: string): string => `${from} -> ${to}`;

/** Test and typecheck files exercise team code directly, so they are exempt from rule 2 (rule 1 still applies). */
const TEST_OR_TYPECHECK_FILE = /\.(test|spec|typecheck)\.(ts|tsx|mts)$/;
const isTestOrTypecheckFile = (file: string): boolean => TEST_OR_TYPECHECK_FILE.test(file);

/** The team folder a repo-relative file belongs to, or null for root-level shared files and the registry. */
function teamOf(file: string): string | null {
  if (!file.startsWith(TEAMS)) return null;
  const [folder, ...rest] = file.slice(TEAMS.length).split('/');
  return rest.length > 0 ? folder : null;
}

function isImportOrRequire(call: ts.CallExpression): boolean {
  return (
    call.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(call.expression) && call.expression.text === 'require')
  );
}

/** Module specifiers of every import, export-from, import(), require(), and import("...") type in one file. */
function specifiersOf({ path: file, text }: SourceFile): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      out.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      out.push(node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      isImportOrRequire(node) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push(node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      out.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** Repo-relative file a specifier names, or null for external packages and unresolvable paths. */
function resolveSpecifier(
  from: string,
  specifier: string,
  exists: (file: string) => boolean
): string | null {
  let base: string;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = path.posix.join(path.posix.dirname(from), specifier);
  } else if (specifier.startsWith(BACKEND_ALIAS)) {
    base = BACKEND_PREFIX + specifier.slice(BACKEND_ALIAS.length);
  } else {
    return null;
  }
  base = base.replace(/\.(m|c)?js$/, '');
  return (
    [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.mts`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ].find(exists) ?? null
  );
}

function collectImportSites(
  files: readonly SourceFile[],
  exists: (file: string) => boolean
): ImportSite[] {
  return files.flatMap((file) => {
    // A file outside teams/ can reach teams/ only by spelling a `teams` segment, so skip the parse otherwise.
    if (!file.path.startsWith(TEAMS) && !file.text.includes('teams')) return [];
    return specifiersOf(file).flatMap((specifier) => {
      const to = resolveSpecifier(file.path, specifier, exists);
      return to ? [{ from: file.path, specifier, to }] : [];
    });
  });
}

function checkBoundaries(
  sites: readonly ImportSite[],
  allowlist: readonly AllowedTeamImport[]
): BoundaryReport {
  const crossTeam: string[] = [];
  const unlisted: string[] = [];
  const matched = new Set<string>();
  for (const site of sites) {
    if (site.to === REGISTRY) continue;
    if (site.from.startsWith(TEAMS)) {
      const fromTeam = teamOf(site.from);
      const toTeam = teamOf(site.to);
      if (fromTeam !== null && toTeam !== null && fromTeam !== toTeam) {
        crossTeam.push(
          `${site.from} (team ${fromTeam}) imports ${site.to} (team ${toTeam}) via "${site.specifier}"`
        );
      }
      continue;
    }
    if (!site.to.startsWith(TEAMS)) continue;
    if (isTestOrTypecheckFile(site.from)) continue;
    const key = pairKey(site.from, site.to);
    if (allowlist.some((entry) => pairKey(entry.from, entry.to) === key)) {
      matched.add(key);
    } else {
      unlisted.push(
        `${site.from} imports team code ${site.to} via "${site.specifier}"; import through ${REGISTRY} or add a justified ALLOWED_TEAM_IMPORTS entry`
      );
    }
  }
  const stale = allowlist
    .map((entry) => pairKey(entry.from, entry.to))
    .filter((key) => !matched.has(key));
  return { crossTeam, unlisted, stale };
}

const SKIPPED_DIRS = new Set(['node_modules', 'dist']);

/** Every non-declaration TypeScript file in the repo, skipping dot-directories (.next, .turbo, .chatroom, .git). */
function readRepoSources(): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (/\.(ts|tsx|mts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push({
          path: path.relative(REPO_ROOT, absolute).split(path.sep).join('/'),
          text: fs.readFileSync(absolute, 'utf8'),
        });
      }
    }
  };
  walk(REPO_ROOT);
  return files;
}

const existsInRepo = (file: string): boolean => {
  try {
    return fs.statSync(path.join(REPO_ROOT, file)).isFile();
  } catch {
    return false;
  }
};

describe('boundary rules on in-memory sources', () => {
  const DUO_PLANNER = `${TEAMS}duo/prompts/planner.ts`;
  const DUO_HELPERS = `${TEAMS}duo/prompts/helpers.ts`;
  const TRIO_COORDINATOR = `${TEAMS}trio/prompts/coordinator.ts`;
  const SHARED_GATES = `${TEAMS}entry-point-coordination-gates.ts`;
  const SOLO_SOLO = `${TEAMS}solo/prompts/solo.ts`;
  const OUTSIDE = 'services/backend/prompts/sections/example.ts';
  const OUTSIDE_TEST = 'services/backend/prompts/sections/example.test.ts';
  const OUTSIDE_TYPECHECK = 'services/backend/prompts/sections/example.typecheck.ts';
  const OUTSIDE_NAME_ONLY = 'services/backend/prompts/sections/latest.ts';
  const DUO_TEST = `${TEAMS}duo/prompts/planner.test.ts`;
  const known = new Set([
    DUO_PLANNER,
    DUO_HELPERS,
    TRIO_COORDINATOR,
    SHARED_GATES,
    SOLO_SOLO,
    REGISTRY,
    OUTSIDE,
    OUTSIDE_TEST,
    OUTSIDE_TYPECHECK,
    OUTSIDE_NAME_ONLY,
    DUO_TEST,
  ]);
  const exists = (file: string): boolean => known.has(file);
  const check = (
    file: string,
    text: string,
    allowlist: readonly AllowedTeamImport[] = []
  ): BoundaryReport =>
    checkBoundaries(collectImportSites([{ path: file, text }], exists), allowlist);

  test('relative import from one team folder into another is reported', () => {
    const report = check(DUO_PLANNER, `import { c } from '../../trio/prompts/coordinator';`);
    expect(report.crossTeam).toHaveLength(1);
    expect(report.crossTeam[0]).toContain(DUO_PLANNER);
    expect(report.crossTeam[0]).toContain('trio');
  });

  test('alias import from one team folder into another is reported', () => {
    const report = check(
      DUO_PLANNER,
      `import type * as C from '@workspace/backend/prompts/teams/trio/prompts/coordinator';`
    );
    expect(report.crossTeam).toHaveLength(1);
  });

  test.each([
    ['dynamic import()', `const m = await import('../../trio/prompts/coordinator');`],
    ['require()', `const m = require('../../trio/prompts/coordinator');`],
    ['re-export', `export * from '../../trio/prompts/coordinator';`],
  ])('%s into another team is reported', (_name, text) => {
    expect(check(DUO_PLANNER, text).crossTeam).toHaveLength(1);
  });

  test('comments and string contents are not imports', () => {
    const text = `// import '../../trio/prompts/coordinator';\nconst s = "import('../../trio/prompts/coordinator')";`;
    expect(check(DUO_PLANNER, text).crossTeam).toEqual([]);
  });

  test('same-team and root-level shared imports are allowed', () => {
    expect(check(DUO_PLANNER, `import { h } from './helpers';`).crossTeam).toEqual([]);
    expect(
      check(DUO_PLANNER, `import { g } from '../../entry-point-coordination-gates';`).crossTeam
    ).toEqual([]);
  });

  test('outside file importing team code without a pin names importer and target', () => {
    const report = check(OUTSIDE, `import { c } from '../teams/trio/prompts/coordinator';`);
    expect(report.unlisted).toHaveLength(1);
    expect(report.unlisted[0]).toContain(OUTSIDE);
    expect(report.unlisted[0]).toContain(TRIO_COORDINATOR);
  });

  test('outside file importing the registry is allowed', () => {
    expect(check(OUTSIDE, `import { r } from '../teams/registry';`).unlisted).toEqual([]);
  });

  test('outside file importing team code is allowed when pinned', () => {
    const pinned = [{ from: OUTSIDE, to: TRIO_COORDINATOR, reason: 'fixture' }];
    expect(
      check(OUTSIDE, `import { c } from '../teams/trio/prompts/coordinator';`, pinned).unlisted
    ).toEqual([]);
  });

  test('a pinned entry that matches no import is reported as stale', () => {
    const pinned = [{ from: OUTSIDE, to: TRIO_COORDINATOR, reason: 'fixture' }];
    expect(check(OUTSIDE, `export const x = 1;`, pinned).stale).toEqual([
      pairKey(OUTSIDE, TRIO_COORDINATOR),
    ]);
  });

  test.each([OUTSIDE_TEST, OUTSIDE_TYPECHECK])(
    'test or typecheck file %s may import team code without a pin',
    (file) => {
      expect(
        check(file, `import { c } from '../teams/trio/prompts/coordinator';`).unlisted
      ).toEqual([]);
    }
  );

  test('a file whose name only contains "test" is still checked', () => {
    expect(
      check(OUTSIDE_NAME_ONLY, `import { c } from '../teams/trio/prompts/coordinator';`).unlisted
    ).toHaveLength(1);
  });

  test('a pin for a test file is reported as stale because test files are exempt', () => {
    const pinned = [{ from: OUTSIDE_TEST, to: TRIO_COORDINATOR, reason: 'fixture' }];
    expect(
      check(OUTSIDE_TEST, `import { c } from '../teams/trio/prompts/coordinator';`, pinned).stale
    ).toEqual([pairKey(OUTSIDE_TEST, TRIO_COORDINATOR)]);
  });

  test('a test file inside a team folder still may not import another team', () => {
    expect(
      check(DUO_TEST, `import { c } from '../../trio/prompts/coordinator';`).crossTeam
    ).toHaveLength(1);
  });
});

describe('team prompt import boundaries on the real repository', () => {
  const sites = collectImportSites(readRepoSources(), existsInRepo);
  const report = checkBoundaries(sites, ALLOWED_TEAM_IMPORTS);

  test('the scan sees a known registry import (guards against a silent no-op scan)', () => {
    expect(sites).toContainEqual(
      expect.objectContaining({
        from: 'services/backend/prompts/sections/team-context.ts',
        to: REGISTRY,
      })
    );
  });

  test('no team folder imports another team folder', () => {
    expect(report.crossTeam).toEqual([]);
  });

  test('files outside prompts/teams reach team code only via the registry or the pinned allowlist', () => {
    expect(report.unlisted).toEqual([]);
  });

  test('every pinned allowlist entry still matches a real import site', () => {
    expect(report.stale).toEqual([]);
  });
});
