/** Cross-composer prefill via window events (messages composer only). */

import {
  createExplorerSnippetAttachment,
  renderInlineReference,
  type ExplorerSnippetAttachment,
} from './explorerSelectionAttachment';

const COMPOSER_PREFILL_EVENT = 'chatroom:composer-prefill';

export interface ComposerPrefillDetail {
  target: 'messages';
  fileSource: string;
  selectedContent: string;
}

export function dispatchComposerPrefill(detail: ComposerPrefillDetail): void {
  window.dispatchEvent(new CustomEvent(COMPOSER_PREFILL_EVENT, { detail }));
}

/** Build prefill payload for Cmd+I explorer selection. */
export function buildExplorerSelectionPrefill(
  fileSource: string,
  selectedContent: string,
  existingReferences?: Iterable<string>
): {
  attachment: ExplorerSnippetAttachment;
  messageBody: string;
} {
  const attachment = createExplorerSnippetAttachment(
    fileSource,
    selectedContent,
    existingReferences
  );
  const messageBody = renderInlineReference(attachment.reference);
  return { attachment, messageBody };
}

export function subscribeComposerPrefill(
  handler: (detail: ComposerPrefillDetail) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ComposerPrefillDetail>).detail;
    if (!detail || detail.target !== 'messages') return;
    handler(detail);
  };

  window.addEventListener(COMPOSER_PREFILL_EVENT, listener);
  return () => window.removeEventListener(COMPOSER_PREFILL_EVENT, listener);
}

export const PREFILL_TOAST_MESSAGE = 'Selection added to Messages composer';
