import { describe, expect, it } from 'vitest';

import { getChatroomMobileFooterSafeAreaStyle } from './chatroomMobileSafeArea';

describe('getChatroomMobileFooterSafeAreaStyle', () => {
  it('returns no styles for desktop footers', () => {
    expect(getChatroomMobileFooterSafeAreaStyle(false)).toEqual({});
  });

  it('includes horizontal and bottom safe-area styles on mobile', () => {
    expect(getChatroomMobileFooterSafeAreaStyle(true)).toEqual({
      paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
      paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    });
  });
});
