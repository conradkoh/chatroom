import { describe, expect, it } from 'vitest';

import {
  composerAccessoryButtonClassName,
  composerAccessoryRowClassName,
} from './composerAccessoryButtonStyles';

describe('composerAccessoryButtonStyles', () => {
  it('uses surface background to match composer chrome', () => {
    expect(composerAccessoryButtonClassName).toContain('bg-chatroom-bg-surface');
    expect(composerAccessoryButtonClassName).not.toContain('bg-chatroom-bg-primary');
  });

  it('exports row wrapper class for accessory toolbar rows', () => {
    expect(composerAccessoryRowClassName).toBe('px-2 pt-1');
  });
});
