import { describe, expect, test } from 'vitest';

import { VERIFICATION_KINDS } from './verification-kinds';

describe('VERIFICATION_KINDS', () => {
  test('lists the verification kinds in report order', () => {
    expect(VERIFICATION_KINDS.map((kind) => kind.id)).toEqual([
      'typecheck',
      'lint',
      'unit',
      'integration',
      'e2e',
    ]);
  });

  test('marks typecheck and lint as the lightweight kinds', () => {
    expect(VERIFICATION_KINDS.filter((kind) => kind.lightweight).map((kind) => kind.id)).toEqual([
      'typecheck',
      'lint',
    ]);
  });
});
