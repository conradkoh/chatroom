import { describe, it, expect } from 'vitest';

import { shortCommit } from '../shared/commits.js';

describe('shortCommit', () => {
  it('returns the first 7 characters of a commit SHA', () => {
    expect(shortCommit('fdef4e84d9abc1234567890abcdef1234567890')).toBe('fdef4e8');
  });
});
