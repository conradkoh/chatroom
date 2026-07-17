import { describe, expect, it } from 'vitest';

import {
  chatroomIndustrialModalContentClassName,
  chatroomIndustrialOverlayClassName,
} from './industrialDialogStyles';

describe('industrialDialogStyles overlay z-index', () => {
  it('uses z-50 for all dialogs', () => {
    expect(chatroomIndustrialOverlayClassName).toContain('z-50');
    expect(chatroomIndustrialModalContentClassName.join(' ')).toContain('z-50');
  });
});
