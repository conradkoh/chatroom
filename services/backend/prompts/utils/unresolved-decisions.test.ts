import { describe, expect, test } from 'vitest';

import { getUnresolvedDecisionsSectionBlock } from './unresolved-decisions';

describe('unresolved decisions section block', () => {
  test('includes section heading and carry-forward instructions', () => {
    const block = getUnresolvedDecisionsSectionBlock();
    expect(block).toContain('## Unresolved Decisions');
    expect(block).toContain('Carry forward decisions still open from earlier handoffs');
    expect(block).toContain(
      "Do not decide on the user's behalf unless they explicitly asked you to"
    );
    expect(block).toContain('Not Applicable');
  });
});
