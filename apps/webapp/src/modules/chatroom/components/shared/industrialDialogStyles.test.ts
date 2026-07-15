import { describe, expect, it } from 'vitest';

import {
  chatroomIndustrialFloatingModalContentClassName,
  chatroomIndustrialFloatingOverlayClassName,
  chatroomIndustrialModalContentClassName,
  chatroomIndustrialOverlayClassName,
} from './industrialDialogStyles';
import { Z_FLOATING } from './overlayLayers';

describe('industrialDialogStyles overlay z-index', () => {
  it('uses z-50 for standalone page-level dialogs', () => {
    expect(chatroomIndustrialOverlayClassName).toContain('z-50');
    expect(chatroomIndustrialOverlayClassName).not.toContain(Z_FLOATING);
    expect(chatroomIndustrialModalContentClassName.join(' ')).toContain('z-50');
    expect(chatroomIndustrialModalContentClassName.join(' ')).not.toContain(Z_FLOATING);
  });

  it('uses Z_FLOATING for nested dialogs inside FixedModal', () => {
    expect(chatroomIndustrialFloatingOverlayClassName).toContain(Z_FLOATING);
    expect(chatroomIndustrialFloatingOverlayClassName).not.toContain(' z-50');
    expect(chatroomIndustrialFloatingModalContentClassName.join(' ')).toContain(Z_FLOATING);
    expect(chatroomIndustrialFloatingModalContentClassName.join(' ')).not.toContain(' z-50');
  });
});
