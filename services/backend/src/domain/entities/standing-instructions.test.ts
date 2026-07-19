import { describe, expect, test } from 'vitest';

import { getActiveStandingInstructions } from './standing-instructions';

describe('getActiveStandingInstructions', () => {
  test('returns content when enabled and content is present', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructionsEnabled: true,
        standingInstructions: '  Always use TypeScript  ',
      })
    ).toBe('Always use TypeScript');
  });

  test('returns null when disabled', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructionsEnabled: false,
        standingInstructions: 'Do something',
      })
    ).toBeNull();
  });

  test('returns null when enabled is not true', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructions: 'Do something',
      })
    ).toBeNull();
  });

  test('returns null when content is empty', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructionsEnabled: true,
        standingInstructions: '',
      })
    ).toBeNull();
  });

  test('returns null when content is whitespace only', () => {
    expect(
      getActiveStandingInstructions({
        standingInstructionsEnabled: true,
        standingInstructions: '   ',
      })
    ).toBeNull();
  });
});
