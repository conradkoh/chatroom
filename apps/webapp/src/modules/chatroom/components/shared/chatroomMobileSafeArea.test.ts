import { describe, expect, it } from 'vitest';

import {
  getChatroomMobileFooterHorizontalSafeAreaStyle,
  getChatroomMobileFooterSafeAreaStyle,
} from './chatroomMobileSafeArea';

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

  it('omits bottom safe-area when suppressBottomInset is true', () => {
    expect(getChatroomMobileFooterSafeAreaStyle(true, { suppressBottomInset: true })).toEqual({
      paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
      paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
    });
  });
});

describe('getChatroomMobileFooterHorizontalSafeAreaStyle', () => {
  it('returns no styles for desktop footers', () => {
    expect(getChatroomMobileFooterHorizontalSafeAreaStyle(false)).toEqual({});
  });

  it('includes horizontal safe-area styles only on mobile (no paddingBottom)', () => {
    expect(getChatroomMobileFooterHorizontalSafeAreaStyle(true)).toEqual({
      paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
      paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
    });
    expect(getChatroomMobileFooterHorizontalSafeAreaStyle(true)).not.toHaveProperty(
      'paddingBottom'
    );
  });
});
