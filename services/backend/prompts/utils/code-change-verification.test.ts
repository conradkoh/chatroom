import { describe, expect, test } from 'vitest';

import {
  CODE_CHANGE_VERIFICATION_CONFIRMATION,
  BUILDER_CODE_CHANGE_VERIFICATION_CONFIRMATION,
} from './code-change-verification';

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

  test('builder attestation drops the blanket run-tests line and names required and not-applicable kinds', () => {
    expect(BUILDER_CODE_CHANGE_VERIFICATION_CONFIRMATION).not.toContain(
      'I confirm that I have run typecheck and tests'
    );
    expect(BUILDER_CODE_CHANGE_VERIFICATION_CONFIRMATION).toContain(
      'lightweight checks (typecheck and lint) ran'
    );
    expect(BUILDER_CODE_CHANGE_VERIFICATION_CONFIRMATION).toContain('marked `required` ran');
    expect(BUILDER_CODE_CHANGE_VERIFICATION_CONFIRMATION).toContain('marked `not applicable`');
  });
});
