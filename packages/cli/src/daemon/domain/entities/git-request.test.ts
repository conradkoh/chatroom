import { describe, expect, test } from 'vitest';

import { GIT_REQUEST_TYPES, isGitRequestType } from './git-request.js';

describe('git-request', () => {
  test('isGitRequestType accepts all known types', () => {
    for (const type of GIT_REQUEST_TYPES) {
      expect(isGitRequestType(type)).toBe(true);
    }
  });

  test('isGitRequestType rejects unknown types', () => {
    expect(isGitRequestType('unknown_type')).toBe(false);
    expect(isGitRequestType('')).toBe(false);
  });
});
