import { describe, expect, it } from 'vitest';

import {
  getSelectionPrefillNotice,
  isMessagesComposerVisible,
  type ComposerVisibilityState,
} from './selectionPrefillNotice';

const NOTICE = 'Selection added to Messages composer';

const cases: {
  activeView: ComposerVisibilityState['activeView'];
  split: boolean;
  expected: string | null;
}[] = [
  { activeView: 'messages', split: false, expected: null },
  { activeView: 'messages', split: true, expected: null },
  { activeView: 'explorer', split: true, expected: null },
  { activeView: 'source-control', split: true, expected: null },
  { activeView: 'explorer', split: false, expected: NOTICE },
  { activeView: 'source-control', split: false, expected: NOTICE },
  { activeView: 'processes', split: true, expected: NOTICE },
  { activeView: 'pull-requests', split: true, expected: NOTICE },
  { activeView: 'pull-requests', split: false, expected: NOTICE },
];

describe('getSelectionPrefillNotice', () => {
  it.each(cases)('$activeView with split view $split', ({ activeView, split, expected }) => {
    expect(getSelectionPrefillNotice({ activeView, explorerSplitViewEnabled: split })).toBe(
      expected
    );
  });
});

describe('isMessagesComposerVisible', () => {
  it('is true when the messages view is active', () => {
    expect(
      isMessagesComposerVisible({ activeView: 'messages', explorerSplitViewEnabled: false })
    ).toBe(true);
  });

  it('is false when the messages composer is not rendered', () => {
    expect(
      isMessagesComposerVisible({ activeView: 'processes', explorerSplitViewEnabled: true })
    ).toBe(false);
  });
});

describe('selection prefill after the handler opens the split view', () => {
  // ChatroomDashboard evaluates the notice with explorerSplitViewEnabled: true, because the
  // handler always opens the split. These literals pin the user-visible outcome per view.
  const cases = [
    { activeView: 'explorer', expected: null },
    { activeView: 'source-control', expected: null },
    { activeView: 'messages', expected: null },
    { activeView: 'pull-requests', expected: NOTICE },
    { activeView: 'processes', expected: NOTICE },
  ] as const;

  it.each(cases)('$activeView → expected notice $expected', ({ activeView, expected }) => {
    expect(getSelectionPrefillNotice({ activeView, explorerSplitViewEnabled: true })).toBe(
      expected
    );
  });
});
