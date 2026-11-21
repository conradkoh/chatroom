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
