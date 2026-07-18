import { describe, expect, test } from 'vitest';

import { appendStandingInstructionsSection } from './render-standing-instructions.js';

describe('appendStandingInstructionsSection', () => {
  test('emits block when content present', () => {
    const lines: string[] = [];
    appendStandingInstructionsSection(lines, 'Always use TypeScript');
    expect(lines).toEqual([
      '<standing-instructions>',
      'The user has set standing instructions for this chatroom. Apply to every task:',
      'Always use TypeScript',
      '</standing-instructions>',
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
});
