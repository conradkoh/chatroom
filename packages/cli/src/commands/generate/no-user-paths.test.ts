/**
 * Guard the test suite against paid APIs and user files.
 *
 * CI has no `~/Downloads` evidence folders and no `FAL_API_KEY`. A test that
 * reads either is either flaky (silently skipped) or paid, so this guard scans
 * every test source and fails on the patterns that caused past incidents.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SELF = fileURLToPath(import.meta.url);
const SRC_ROOT = resolve(dirname(SELF), '../..');

const FORBIDDEN_PATHS: { pattern: RegExp; why: string }[] = [
  { pattern: /Downloads/, why: 'tests must not read or write ~/Downloads' },
  { pattern: /homedir\(/, why: 'tests must not read the real home directory' },
  { pattern: /os\.homedir/, why: 'tests must not read the real home directory' },
  { pattern: /process\.env\.HOME/, why: 'tests must not depend on the real HOME' },
  { pattern: /CHATROOM_BG_FIXTURE_DIR/, why: 'fixtures must be checked in or synthesised' },
];

const SENTINEL_KEY_VALUES = ['sentinel', 'should-never', 'do-not-print', 'never-printed', 'test'];

function listTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listTestFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(path);
  }
  return files;
}

function offenders(pattern: RegExp): string[] {
  const found: string[] = [];
  for (const file of listTestFiles(SRC_ROOT)) {
    if (file === SELF) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (pattern.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe('test-suite constraints', () => {
  it.each(FORBIDDEN_PATHS)('does not use $why', ({ pattern }) => {
    expect(offenders(pattern)).toEqual([]);
  });

  it('does not assign a real-looking FAL_API_KEY', () => {
    const assignments: string[] = [];
    for (const file of listTestFiles(SRC_ROOT)) {
      if (file === SELF) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/FAL_API_KEY\s*=\s*['"]([^'"]+)['"]/g)) {
        const value = match[1] ?? '';
        if (!SENTINEL_KEY_VALUES.some((sentinel) => value.includes(sentinel))) {
          assignments.push(`${file}: ${value}`);
        }
      }
    }
    expect(assignments).toEqual([]);
  });

  it('mocks @fal-ai/client in every test that imports it', () => {
    const offenders: string[] = [];
    for (const file of listTestFiles(SRC_ROOT)) {
      if (file === SELF) continue;
      const source = readFileSync(file, 'utf8');
      const importsFal = /from\s+['"]@fal-ai\/client['"]/.test(source);
      if (importsFal && !source.includes("vi.mock('@fal-ai/client'")) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
