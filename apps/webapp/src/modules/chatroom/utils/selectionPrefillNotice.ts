import { SELECTION_PREFILL_NOTICE } from '../attachments';
import type { ActivityView } from '../components/ActivityBar';

export interface ComposerVisibilityState {
  activeView: ActivityView;
  explorerSplitViewEnabled: boolean;
}

/** True when the Messages composer is rendered for this dashboard state. */
export function isMessagesComposerVisible({
  activeView,
  explorerSplitViewEnabled,
}: ComposerVisibilityState): boolean {
  return (
    activeView === 'messages' ||
    ((activeView === 'explorer' || activeView === 'source-control') && explorerSplitViewEnabled)
  );
}

/** Info text for a file-selection prefill, or null when the composer is already visible. */
export function getSelectionPrefillNotice(state: ComposerVisibilityState): string | null {
  return isMessagesComposerVisible(state) ? null : SELECTION_PREFILL_NOTICE;
}
