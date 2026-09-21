import { afterEach, describe, expect, test, vi } from 'vitest';

import { printHandoffViewTemplate } from './view-template.js';

describe('printHandoffViewTemplate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each([
    ['architect', /module boundaries|schemas/i],
    ['uiux-engineer', /loading\/empty\/error\/success|accessibility/i],
  ] as const)('prints the generic %s specialist template', (role, focus) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    printHandoffViewTemplate({ role });

    expect(log).toHaveBeenCalledOnce();
    const [template] = log.mock.calls[0] as [string];
    expect(template).toMatch(focus);
    expect(template).toContain('<entry-point-role>');
  });

  test('prints a concrete pair template when nextRole is supplied', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    printHandoffViewTemplate({ role: 'architect', nextRole: 'planner', teamId: 'duo' });

    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[0]).toContain('--next-role="planner"');
  });
});
