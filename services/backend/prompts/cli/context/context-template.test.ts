import { describe, expect, test } from 'vitest';

import { getContextViewTemplate } from './context-template';

describe('getContextViewTemplate', () => {
  test('includes Goal, Requirements, Structure, Avoid in order', () => {
    const t = getContextViewTemplate();
    expect(t.indexOf('## Goal')).toBeLessThan(t.indexOf('## Requirements'));
    expect(t.indexOf('## Requirements')).toBeLessThan(t.indexOf('## Structure'));
    expect(t.indexOf('## Structure')).toBeLessThan(t.indexOf('## Avoid'));
  });

  test('contains no angle-bracket placeholders', () => {
    expect(getContextViewTemplate()).not.toMatch(/</);
  });
});
