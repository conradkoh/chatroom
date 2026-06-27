import { describe, expect, test } from 'vitest';

import { getUserVerificationReminder } from './task-verification';

describe('getUserVerificationReminder', () => {
  test('skips typecheck for connectivity brief with explicit no typecheck', () => {
    const reminder = getUserVerificationReminder(
      '## Requirements\n- Do **not** run `pnpm typecheck`, `pnpm test`, or any other verification commands'
    );
    expect(reminder).toContain('No codebase verification needed');
    expect(reminder).not.toContain('pnpm typecheck');
  });

  test('skips typecheck for builder handback with not applicable verification', () => {
    const reminder = getUserVerificationReminder(
      '## Summary\nConnectivity test passed.\n## Proof of Completion\nNot Applicable\n## Verification\nNot Applicable'
    );
    expect(reminder).toContain('No codebase verification needed');
    expect(reminder).not.toContain('pnpm typecheck');
  });

  test('skips typecheck reminder for no-code slices', () => {
    const reminder = getUserVerificationReminder(
      '## Goal\nConnectivity-only test. No code changes.'
    );
    expect(reminder).toContain('No codebase verification needed');
    expect(reminder).not.toContain('pnpm typecheck');
  });

  test('includes typecheck reminder for implementation slices', () => {
    expect(getUserVerificationReminder('Implement feature X')).toContain(
      'pnpm typecheck && pnpm test'
    );
    expect(
      getUserVerificationReminder('## Goal\nImplement dark mode toggle in settings page.')
    ).toContain('pnpm typecheck && pnpm test');
  });
});
