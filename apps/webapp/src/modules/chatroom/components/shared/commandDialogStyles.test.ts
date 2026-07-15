import { describe, expect, it } from 'vitest';

import { COMMAND_DIALOG_CONTENT_CLASSES } from './commandDialogStyles';

describe('commandDialogStyles close animation', () => {
  const classNames = COMMAND_DIALOG_CONTENT_CLASSES.join(' ');

  it('persists exit animation end state to prevent forceMount close flash', () => {
    expect(classNames).toContain('data-[state=closed]:fill-mode-forwards');
    expect(classNames).toContain('data-[state=closed]:pointer-events-none');
  });
});
