import { describe, expect, it } from 'vitest';

import {
  COMMAND_DIALOG_CONTENT_CLASSES,
  getCommandDialogContentStyle,
} from './commandDialogStyles';

describe('commandDialogStyles close animation', () => {
  const classNames = COMMAND_DIALOG_CONTENT_CLASSES.join(' ');

  it('persists exit animation end state to prevent forceMount close flash', () => {
    expect(classNames).toContain('data-[state=closed]:fill-mode-forwards');
    expect(classNames).toContain('data-[state=closed]:pointer-events-none');
  });
});

describe('getCommandDialogContentStyle', () => {
  it('returns empty style when offset is 0 (Tailwind top-[10%] controls position)', () => {
    expect(getCommandDialogContentStyle(0)).toEqual({});
  });

  it('returns empty style when offset is negative', () => {
    expect(getCommandDialogContentStyle(-10)).toEqual({});
  });

  it('returns top calc with offset + safe-area + 16px when offset > 0', () => {
    const style = getCommandDialogContentStyle(120);
    expect(style).toEqual({
      top: 'calc(120px + env(safe-area-inset-top, 0px) + 16px)',
    });
  });
});
