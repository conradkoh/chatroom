import { describe, expect, test } from 'vitest';

import { getDelegationBriefDisclosureBlock } from './delegation-disclosure';

describe('delegation-disclosure', () => {
  test('includes checkbox attesting delegation brief completion', () => {
    const block = getDelegationBriefDisclosureBlock({ briefSourceRole: 'planner' });
    expect(block).toContain('verified end-to-end');
    expect(block).toContain('(Required) files done');
  });

  test('includes comment referencing Goal and Requirements sections', () => {
    const block = getDelegationBriefDisclosureBlock({ briefSourceRole: 'planner' });
    expect(block).toContain('## Goal');
    expect(block).toContain('## Requirements (acceptance criteria)');
  });

  test('names the role that sent the brief', () => {
    expect(getDelegationBriefDisclosureBlock({ briefSourceRole: 'planner' })).toContain(
      'from the planner handoff you received'
    );
    expect(getDelegationBriefDisclosureBlock({ briefSourceRole: 'specifier' })).toContain(
      'from the specifier handoff you received'
    );
  });

  test('requires the brief source role', () => {
    // @ts-expect-error briefSourceRole is required so the disclosure never names the wrong role
    expect(() => getDelegationBriefDisclosureBlock()).toThrow();
  });
});
