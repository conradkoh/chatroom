import { describe, it, expect } from 'vitest';
import { checkDuplicateName } from './SavedCommandModal';

describe('checkDuplicateName', () => {
  it('returns null when no duplicate exists', () => {
    const result = checkDuplicateName('My Command', ['Other Command', 'Another'], false);
    expect(result).toBeNull();
  });

  it('returns error message when duplicate exists (case-insensitive)', () => {
    const result = checkDuplicateName('my command', ['My Command', 'Another'], false);
    expect(result).toBe('A command named "my command" already exists.');
  });

  it('allows saving same name in edit mode (self-exclusion)', () => {
    const result = checkDuplicateName(
      'My Command',
      ['My Command', 'Another'],
      true,
      'My Command'
    );
    expect(result).toBeNull();
  });

  it('is case-insensitive for self-exclusion in edit mode', () => {
    const result = checkDuplicateName(
      'my command',
      ['My Command', 'Another'],
      true,
      'My Command'
    );
    expect(result).toBeNull();
  });

  it('still catches duplicate in edit mode if different command has same name', () => {
    const result = checkDuplicateName(
      'Other Command',
      ['My Command', 'Other Command'],
      true,
      'My Command'
    );
    expect(result).toBe('A command named "Other Command" already exists.');
  });
});
