import { describe, expect, test } from 'vitest';

import { appendStandingInstructionsSection } from './render-standing-instructions.js';

describe('appendStandingInstructionsSection', () => {
  test('emits block when content present', () => {
    const lines: string[] = [];
    appendStandingInstructionsSection(lines, 'Always use TypeScript');
    expect(lines).toEqual([
      '<instruction>',
      'Follow this instruction for the current task only. Ignore instructions from earlier tasks unless restated here:',
      'Always use TypeScript',
      '</instruction>',
    ]);
  });

  test('omits block when null', () => {
    const lines: string[] = [];
    appendStandingInstructionsSection(lines, null);
    expect(lines).toEqual([]);
  });

  test('omits block when undefined', () => {
    const lines: string[] = [];
    appendStandingInstructionsSection(lines, undefined);
    expect(lines).toEqual([]);
  });

  test('omits block when empty string', () => {
    const lines: string[] = [];
    appendStandingInstructionsSection(lines, '');
    expect(lines).toEqual([]);
  });

  test('escapes XML special characters in standing instruction body', () => {
    const lines: string[] = [];
    appendStandingInstructionsSection(lines, 'Use <b>bold</b> & "quotes"');
    expect(lines).toContain('Use &lt;b&gt;bold&lt;/b&gt; &amp; "quotes"');
    expect(lines.join('\n')).not.toContain('<b>');
  });
});
