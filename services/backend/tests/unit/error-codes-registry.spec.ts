/**
 * Error Codes Registry Enforcement Test
 *
 * Scans all backend source files and verifies two invariants:
 *
 * 1. No new bare-string ConvexError throws outside the baseline.
 *    The baseline captures existing bare-string throws that predate this
 *    convention. It is SHRINKING-ONLY: any commit that reduces a count must
 *    update the baseline. New entries are forbidden — migrate the throw
 *    to the structured form instead. When baseline reaches zero, the
 *    allow-list entries are removed entirely and bare-string throws are
 *    forbidden everywhere with zero exceptions.
 *
 * 2. Every code used in a structured throw (`{ code: 'X', message: ... }`)
 *    is registered in BACKEND_ERROR_CODES. This prevents typos and drift.
 *
 * Pattern: baseline/allow-list approach inspired by eslint-baseline and
 * tsc-baseline. Cite those if asked.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { BACKEND_ERROR_CODES } from '../../config/errorCodes';

// ─── Configuration ────────────────────────────────────────────────────────────

const BACKEND_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['convex', 'src'];

// ─── Baseline: bare-string throws allowed per file ───────────────────────────
// INTENT: this list is SHRINKING-ONLY. Any commit that reduces a count must
// update the baseline below. New entries are forbidden — migrate the throw
// to the structured form { code, message } instead.
// When all counts reach 0, remove the entries and the allow-list logic entirely.
const BARE_STRING_BASELINE: Record<string, number> = {
  'convex/chatrooms.ts': 2,
  'convex/attendance.ts': 3,
  'convex/auth/authenticatedUser.ts': 1,
  'convex/backlog.ts': 9,
  'convex/chatroomSkillCustomizations.ts': 1,
  'convex/commands.ts': 9,
  'convex/contexts.ts': 1,
  'convex/machines.ts': 2,
  'convex/savedCommands.ts': 5,
  'src/domain/usecase/backlog/create-backlog-item.ts': 1,
  'src/domain/usecase/backlog/patch-backlog-item.ts': 1,
  'src/domain/usecase/backlog/update-backlog-item.ts': 2,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAllTsFiles(root: string, dirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of dirs) {
    const dirPath = path.join(root, dir);
    if (!fs.existsSync(dirPath)) continue;
    const walk = (d: string) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          files.push(full);
        }
      }
    };
    walk(dirPath);
  }
  return files;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Error codes registry enforcement', () => {
  const allFiles = getAllTsFiles(BACKEND_ROOT, SOURCE_DIRS);
  const registeredCodes = new Set(Object.values(BACKEND_ERROR_CODES));

  it('every code used in a structured ConvexError throw is registered', () => {
    // Regex for { code: 'SOME_CODE', message: ... } or { code: 'SOME_CODE', ... }
    const codePattern = /code:\s*'([A-Z_]+)'/g;
    const usedCodes = new Set<string>();

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      let match: RegExpExecArray | null;
      while ((match = codePattern.exec(content)) !== null) {
        usedCodes.add(match[1]);
      }
    }

    const unregistered: string[] = [];
    for (const code of usedCodes) {
      if (!registeredCodes.has(code)) {
        unregistered.push(code);
      }
    }

    expect(unregistered, `Unregistered error codes found: ${unregistered.join(', ')}`).toEqual([]);
  });

  it('no new bare-string ConvexError throws outside the baseline', () => {
    // Matches: throw new ConvexError('...') or throw new ConvexError("...")
    // Does NOT match: throw new ConvexError({ code: ... }) or template literals
    const bareStringPattern = /throw new ConvexError\(['"][^'"]+['"]\)/g;

    // Count actual bare-string throws per file (relative to BACKEND_ROOT)
    const actualCounts: Record<string, number> = {};
    for (const file of allFiles) {
      const rel = path.relative(BACKEND_ROOT, file);
      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(bareStringPattern);
      if (matches && matches.length > 0) {
        actualCounts[rel] = matches.length;
      }
    }

    // Check: no files with bare-string throws that aren't in the baseline
    const newFiles = Object.keys(actualCounts).filter((f) => !(f in BARE_STRING_BASELINE));
    expect(newFiles, `Files with new bare-string ConvexError throws (not in baseline): ${newFiles.join(', ')}`).toEqual([]);

    // Check: no file exceeds its baseline count
    for (const [file, count] of Object.entries(actualCounts)) {
      const baseline = BARE_STRING_BASELINE[file] ?? 0;
      expect(count, `${file} has ${count} bare-string throws, baseline allows ${baseline}. Update baseline if you migrated throws.`).toBeLessThanOrEqual(baseline);
    }
  });

  it('all registered codes are classified as fatal or non-fatal', async () => {
    // Dynamic import to get the classification arrays from the same module
    const mod = await import('../../config/errorCodes');
    const allClassified = new Set([...mod.FATAL_ERROR_CODES, ...mod.NON_FATAL_ERROR_CODES]);
    const unclassified: string[] = [];

    for (const code of Object.values(BACKEND_ERROR_CODES) as string[]) {
      if (!allClassified.has(code)) {
        unclassified.push(code);
      }
    }

    expect(unclassified, `Codes not classified as fatal or non-fatal: ${unclassified.join(', ')}`).toEqual([]);
  });
});