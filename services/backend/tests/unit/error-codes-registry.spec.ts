/**
 * Error Codes Registry Enforcement Test
 *
 * Scans all backend source files and verifies two invariants:
 *
 * 1. No bare-string ConvexError throws anywhere in the codebase.
 *    All ConvexError calls must use the structured `{ code, message }` form.
 *    Bare-string throws are forbidden — migrate to the structured form instead.
 *
 * 2. Every code used in a structured throw (`{ code: 'X', message: ... }`)
 *    is registered in BACKEND_ERROR_CODES. This prevents typos and drift.
 *
 * Pattern: baseline/allow-list approach inspired by eslint-baseline and
 * tsc-baseline. Cite those if asked.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { BACKEND_ERROR_CODES } from '../../config/errorCodes';

// ─── Configuration ────────────────────────────────────────────────────────────

const BACKEND_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['convex', 'src'];

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

  it('no bare-string ConvexError throws anywhere in the codebase', () => {
    // Matches: throw new ConvexError('...') or throw new ConvexError("...")
    // Does NOT match: throw new ConvexError({ code: ... }) or template literals
    const bareStringPattern = /throw new ConvexError\(['"][^'"]+['"]\)/g;

    // Collect all files with bare-string throws
    const violations: string[] = [];
    for (const file of allFiles) {
      const rel = path.relative(BACKEND_ROOT, file);
      const content = fs.readFileSync(file, 'utf-8');
      const matches = content.match(bareStringPattern);
      if (matches && matches.length > 0) {
        violations.push(
          `${rel} (${matches.length} bare-string throw${matches.length > 1 ? 's' : ''})`
        );
      }
    }

    expect(
      violations,
      `Bare-string ConvexError throws found — migrate to { code, message } form:\n${violations.join('\n')}`
    ).toEqual([]);
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

    expect(
      unclassified,
      `Codes not classified as fatal or non-fatal: ${unclassified.join(', ')}`
    ).toEqual([]);
  });
});
