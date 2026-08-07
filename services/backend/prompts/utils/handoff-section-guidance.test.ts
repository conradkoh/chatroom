import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import {
  HANDOFF_NOT_APPLICABLE_EXACT_TEXT,
  getHandoffNotApplicableSectionComment,
  getHandoffReportTemplateIntro,
} from './handoff-section-guidance';

describe('handoff-section-guidance', () => {
  test('HANDOFF_NOT_APPLICABLE_EXACT_TEXT is exactly "Not Applicable."', () => {
    expect(HANDOFF_NOT_APPLICABLE_EXACT_TEXT).toBe('Not Applicable.');
  });

  test('getHandoffNotApplicableSectionComment includes exact text and no-explanation rule', () => {
    const comment = getHandoffNotApplicableSectionComment('List decisions');
    expect(comment).toContain('write exactly "Not Applicable."');
    expect(comment).toContain('with no explanation');
    expect(comment).toContain('List decisions');
    expect(comment).toContain('REQUIRED');
  });

  test('getHandoffReportTemplateIntro includes global N/A callout', () => {
    const intro = getHandoffReportTemplateIntro('Report Template (Planner → User)');
    expect(intro).toContain('Not Applicable.');
    expect(intro).toContain('no explanation');
    expect(intro).toContain('no em-dash');
  });
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPTS_DIR = join(__dirname, '..');
const FORBIDDEN_NA_PATTERNS = [
  /or write "Not Applicable"[^.]/, // old bare form without period
  /or Not Applicable[^."]/, // old "or Not Applicable" in placeholders
];

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      files.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

describe('handoff-section-guidance regression guards', () => {
  test('no prompt source files contain old bare Not Applicable guidance', () => {
    const promptFiles = collectTsFiles(PROMPTS_DIR);
    const violations: string[] = [];

    for (const file of promptFiles) {
      const content = readFileSync(file, 'utf-8');
      for (const pattern of FORBIDDEN_NA_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${file}: matches ${pattern}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('all handoff report template section comments use getHandoffNotApplicableSectionComment', () => {
    const bodyPath = join(__dirname, 'handoff-report-template-body.ts');
    const content = readFileSync(bodyPath, 'utf-8');
    expect(content).not.toMatch(/<!-- REQUIRED\.\s/);
    expect(content).toContain('getHandoffNotApplicableSectionComment');
  });
});
