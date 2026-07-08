#!/usr/bin/env bun
/**
 * Clear stale non-terminal export records from the Convex local backend SQLite DB.
 *
 * Background and maintenance instructions:
 *   docs/developer/convex-local-backend-stale-export-fix.md
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Database } from 'bun:sqlite';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const DOC_RELATIVE_PATH = 'docs/developer/convex-local-backend-stale-export-fix.md';
const DEFAULT_DB_PATH = join(
  scriptDir,
  '..',
  'services',
  'backend',
  '.convex',
  'local',
  'default',
  'convex_local_backend.sqlite3'
);

const STALE_STATES = ['requested', 'in_progress'] as const;

type ExportRow = {
  id: string;
  state: string;
  start_ts: number | null;
  expiration_ts: number | null;
};

type CliArgs = {
  dbPath: string;
  dryRun: boolean;
  deleteAll: boolean;
  help: boolean;
};

const BOOLEAN_FLAGS: Record<string, keyof Pick<CliArgs, 'help' | 'dryRun' | 'deleteAll'>> = {
  '-h': 'help',
  '--help': 'help',
  '--dry-run': 'dryRun',
  '--all': 'deleteAll',
};

function printHelp(): void {
  console.log(`Fix stale Convex local backend export records.

Background and how to update this understanding:
  ${DOC_RELATIVE_PATH}

Usage:
  bun scripts/fix-convex-stale-exports.ts [options]
  pnpm fix:convex-stale-exports [options]

Options:
  --db-path <path>  Path to convex_local_backend.sqlite3 (default: services/backend/.convex/local/default/...)
  --dry-run         Show stale exports without deleting
  --all             Delete ALL export records (nuclear option)
  -h, --help        Show this help
`);
}

function readDbPathValue(argv: string[], index: number): string {
  const next = argv[index];
  if (!next) {
    console.error('Error: --db-path requires a value');
    process.exit(1);
  }
  return next;
}

function failUnknownArg(arg: string): never {
  console.error(`Error: unknown argument: ${arg}`);
  printHelp();
  process.exit(1);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dbPath: DEFAULT_DB_PATH,
    dryRun: false,
    deleteAll: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const flag = BOOLEAN_FLAGS[arg];
    if (flag) {
      args[flag] = true;
      continue;
    }

    if (arg === '--db-path') {
      args.dbPath = readDbPathValue(argv, i + 1);
      i++;
      continue;
    }

    failUnknownArg(arg);
  }

  return args;
}

function formatExportRow(row: ExportRow): string {
  return `  id=${row.id} state=${row.state} start_ts=${row.start_ts ?? 'null'} expiration_ts=${row.expiration_ts ?? 'null'}`;
}

function ensureExportsTable(db: Database): boolean {
  const table = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_exports'")
    .get() as { name: string } | null;
  return table !== null;
}

function listExports(db: Database): ExportRow[] {
  return db
    .query('SELECT id, state, start_ts, expiration_ts FROM _exports ORDER BY start_ts')
    .all() as ExportRow[];
}

function listStaleExports(db: Database): ExportRow[] {
  return db
    .query(
      `SELECT id, state, start_ts, expiration_ts FROM _exports WHERE state IN ('requested', 'in_progress') ORDER BY start_ts`
    )
    .all() as ExportRow[];
}

function printExportRows(exports: ExportRow[], label: string): void {
  console.log(`Found ${exports.length} ${label}:`);
  for (const row of exports) {
    console.log(formatExportRow(row));
  }
}

function deleteAllExports(db: Database, dryRun: boolean): void {
  const exports = listExports(db);
  if (exports.length === 0) {
    console.log('No export records found.');
    return;
  }

  printExportRows(exports, 'export record(s)');

  if (dryRun) {
    console.log('\nDry run — would delete all export records. Re-run without --dry-run to apply.');
    return;
  }

  const result = db.run('DELETE FROM _exports');
  console.log(`\nDeleted ${result.changes} export record(s).`);
  console.log('You can now run pnpm dev again.');
}

function deleteStaleExports(db: Database, dryRun: boolean): void {
  const stale = listStaleExports(db);
  if (stale.length === 0) {
    console.log('No stale exports found (requested or in_progress).');
    return;
  }

  printExportRows(stale, 'stale export record(s)');

  if (dryRun) {
    console.log('\nDry run — would delete stale exports. Re-run without --dry-run to apply.');
    return;
  }

  const result = db.run(
    `DELETE FROM _exports WHERE state IN (${STALE_STATES.map(() => '?').join(', ')})`,
    ...STALE_STATES
  );
  console.log(`\nDeleted ${result.changes} stale export record(s).`);

  const remaining = listStaleExports(db);
  if (remaining.length > 0) {
    console.error(`Warning: ${remaining.length} stale export(s) still remain.`);
    process.exit(1);
  }

  console.log('Verified: no requested or in_progress exports remain.');
  console.log('You can now run pnpm dev again.');
}

function runFix(args: CliArgs): void {
  const db = new Database(args.dbPath, { readonly: args.dryRun });

  try {
    if (!ensureExportsTable(db)) {
      console.log('No _exports table found — nothing to fix.');
      return;
    }

    if (args.deleteAll) {
      deleteAllExports(db, args.dryRun);
    } else {
      deleteStaleExports(db, args.dryRun);
    }
  } finally {
    db.close();
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!existsSync(args.dbPath)) {
    console.error(`Database not found: ${args.dbPath}`);
    console.error('Has the local Convex backend been initialized? Try running pnpm dev first.');
    process.exit(1);
  }

  runFix(args);
}

main();
