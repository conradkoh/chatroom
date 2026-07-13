/** Cross-composer prefill via window events (messages composer only). */

import {
  createExplorerSnippetAttachment,
  renderInlineReference,
  type ExplorerSnippetAttachment,
} from './explorerSelectionAttachment';

const COMPOSER_PREFILL_EVENT = 'chatroom:composer-prefill';
const COMPOSER_TEXT_PREFILL_EVENT = 'chatroom:composer-text-prefill';

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

export interface ComposerTextPrefillDetail {
  target: 'messages';
  content: string;
}

/** Prefill the messages composer with plain text (e.g. saved command prompt). */
export function dispatchComposerTextPrefill(content: string): void {
  window.dispatchEvent(
    new CustomEvent(COMPOSER_TEXT_PREFILL_EVENT, {
      detail: { target: 'messages', content } satisfies ComposerTextPrefillDetail,
    })
  );
}

export function subscribeComposerTextPrefill(
  handler: (detail: ComposerTextPrefillDetail) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ComposerTextPrefillDetail>).detail;
    if (!detail || detail.target !== 'messages' || typeof detail.content !== 'string') return;
    handler(detail);
  };

  window.addEventListener(COMPOSER_TEXT_PREFILL_EVENT, listener);
  return () => window.removeEventListener(COMPOSER_TEXT_PREFILL_EVENT, listener);
}

export const PREFILL_TOAST_MESSAGE = 'Selection added to Messages composer';
export const SAVED_COMMAND_PREFILL_TOAST_MESSAGE = 'Command added to Messages composer';
