import { describe, expect, test } from 'vitest';

import { getBuilderDelegationBriefTemplate } from './builder-delegation-handoff-templates';

const DUO_PLANNER = { delegatorRole: 'planner', gatesOwner: 'self' } as const;

describe('getBuilderDelegationBriefTemplate', () => {
  test('default output is unchanged when batching is unset or false', () => {
    const defaultBody = getBuilderDelegationBriefTemplate(DUO_PLANNER);

    expect(getBuilderDelegationBriefTemplate({ ...DUO_PLANNER, batching: false })).toBe(
      defaultBody
    );
    expect(defaultBody).not.toContain('## Verification scope');
    expect(defaultBody).not.toContain('round-final');
    expect(defaultBody).toContain('Keep one slice ≈ one focused review surface.');
    expect(defaultBody).toContain(
      '- Include at least one check that the feature is **verified end-to-end**. Unit tests alone are insufficient for new features.'
    );
  });

  test('batching output carries the verification scope section before What to avoid', () => {
    const batchBody = getBuilderDelegationBriefTemplate({
      delegatorRole: 'specifier',
      gatesOwner: 'coordinator',
      batching: true,
    });

    expect(batchBody).toContain('## Verification scope');
    expect(batchBody).toContain('`focused`');
    expect(batchBody).toContain('`round-final`');
    expect(batchBody).toContain("on the round's final brief");
    expect(batchBody.indexOf('## Verification scope')).toBeLessThan(
      batchBody.indexOf('## What to avoid')
    );
  });
});
