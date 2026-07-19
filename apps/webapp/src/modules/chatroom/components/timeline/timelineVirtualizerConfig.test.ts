import { describe, it, expect } from 'vitest';

import {
  jumpToNewMessagesBottomOffset,
  shouldTriggerLoadOlder,
  TIMELINE_LOAD_OLDER_SENTINEL_INDEX,
  TIMELINE_LOAD_OLDER_TOP_SCROLL_FRACTION,
} from './timelineVirtualizerConfig';

describe('shouldTriggerLoadOlder', () => {
  const clientHeight = 400;
  const scrollHeight = 2500;
  const maxScrollTop = scrollHeight - clientHeight;

  it('does not trigger at the bottom even when the virtualizer reports a low index', () => {
    expect(
      shouldTriggerLoadOlder({
        scrollTop: maxScrollTop,
        scrollHeight,
        clientHeight,
        firstVisibleIndex: 0,
        topChromeHeight: 32,
      })
    ).toBe(false);
  });

  it('triggers when scrollTop is near the top and the sentinel row is visible', () => {
    expect(
      shouldTriggerLoadOlder({
        scrollTop: maxScrollTop * TIMELINE_LOAD_OLDER_TOP_SCROLL_FRACTION,
        scrollHeight,
        clientHeight,
        firstVisibleIndex: TIMELINE_LOAD_OLDER_SENTINEL_INDEX,
        topChromeHeight: 32,
      })
    ).toBe(true);
  });

  it('does not trigger when scrolled up moderately from the bottom', () => {
    const moderateScrollTop = maxScrollTop - 8 * 100;
    expect(
      shouldTriggerLoadOlder({
        scrollTop: moderateScrollTop,
        scrollHeight,
        clientHeight,
        firstVisibleIndex: 12,
        topChromeHeight: 32,
      })
    ).toBe(false);
  });

  it('does not trigger when near the top but the first visible row is below the sentinel', () => {
    expect(
      shouldTriggerLoadOlder({
        scrollTop: 100,
        scrollHeight,
        clientHeight,
        firstVisibleIndex: TIMELINE_LOAD_OLDER_SENTINEL_INDEX + 1,
        topChromeHeight: 32,
      })
    ).toBe(false);
  });

  describe('jumpToNewMessagesBottomOffset', () => {
    it('returns gap only when footer height is zero', () => {
      expect(jumpToNewMessagesBottomOffset(0)).toBe(8);
    });

    it('returns footer height plus gap', () => {
      expect(jumpToNewMessagesBottomOffset(96)).toBe(104);
    });

    it('clamps negative height to zero before adding gap', () => {
      expect(jumpToNewMessagesBottomOffset(-10)).toBe(8);
    });

    it('accepts custom gap', () => {
      expect(jumpToNewMessagesBottomOffset(96, 16)).toBe(112);
    });
  });

  it('does not trigger when sentinel index is visible but scroll is below the top fraction', () => {
    const belowTopFraction = maxScrollTop * TIMELINE_LOAD_OLDER_TOP_SCROLL_FRACTION + 50;
    expect(
      shouldTriggerLoadOlder({
        scrollTop: belowTopFraction,
        scrollHeight,
        clientHeight,
        firstVisibleIndex: TIMELINE_LOAD_OLDER_SENTINEL_INDEX,
        topChromeHeight: 32,
      })
    ).toBe(false);
  });
});
