import { describe, expect, test } from 'vitest';

import { CODE_CHANGE_VERIFICATION_CONFIRMATION } from './code-change-verification';

describe('code-change-verification', () => {
  test('confirmation includes command and optional-when-no-code-changes framing', () => {
    expect(CODE_CHANGE_VERIFICATION_CONFIRMATION).toContain(
      '- [ ] I confirm that I have run typecheck and tests for the project'
    );
    expect(CODE_CHANGE_VERIFICATION_CONFIRMATION).not.toContain('pnpm');
    expect(CODE_CHANGE_VERIFICATION_CONFIRMATION).toContain(
      '(only required if code changes were made)'
    );
  });
});
