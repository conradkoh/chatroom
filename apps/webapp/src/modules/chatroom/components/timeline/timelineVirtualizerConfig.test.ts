import { describe, it, expect } from 'vitest';

import {
  getLoadOlderNearTopScrollMax,
  shouldTriggerLoadOlder,
  TIMELINE_LOAD_OLDER_SENTINEL_INDEX,
} from './timelineVirtualizerConfig';

describe('shouldTriggerLoadOlder', () => {
  const clientHeight = 400;

  it('does not trigger at the bottom even when the virtualizer reports a low index', () => {
    expect(
      shouldTriggerLoadOlder({
        scrollTop: 2100,
        scrollHeight: 2500,
        clientHeight,
        firstVisibleIndex: 0,
        topChromeHeight: 32,
      })
    ).toBe(false);
  });

  it('triggers when scrollTop is near the top and the sentinel row is visible', () => {
    expect(
      shouldTriggerLoadOlder({
        scrollTop: 120,
        scrollHeight: 2500,
        clientHeight,
        firstVisibleIndex: TIMELINE_LOAD_OLDER_SENTINEL_INDEX,
        topChromeHeight: 32,
      })
    ).toBe(true);
  });

  it('does not trigger when scrolled up but still below the sentinel band', () => {
    const nearTopMax = getLoadOlderNearTopScrollMax(32);
    expect(
      shouldTriggerLoadOlder({
        scrollTop: nearTopMax + 50,
        scrollHeight: 2500,
        clientHeight,
        firstVisibleIndex: 2,
        topChromeHeight: 32,
      })
    ).toBe(false);
  });

  it('does not trigger when near the top but the first visible row is below the sentinel', () => {
    expect(
      shouldTriggerLoadOlder({
        scrollTop: 100,
        scrollHeight: 2500,
        clientHeight,
        firstVisibleIndex: TIMELINE_LOAD_OLDER_SENTINEL_INDEX + 1,
        topChromeHeight: 32,
      })
    ).toBe(false);
  });
});
