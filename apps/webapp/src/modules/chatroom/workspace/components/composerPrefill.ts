/** Cross-composer prefill via window event (messages vs direct harness). */

import { useEffect, type RefObject } from 'react';

const COMPOSER_PREFILL_EVENT = 'chatroom:composer-prefill';

export type ComposerPrefillTarget = 'messages' | 'direct-harness';

export interface ComposerPrefillDetail {
  text: string;
  target: ComposerPrefillTarget;
}

export function dispatchComposerPrefill(detail: ComposerPrefillDetail): void {
  window.dispatchEvent(new CustomEvent(COMPOSER_PREFILL_EVENT, { detail }));
}

/** Build a chatroom/harness message from explorer file selection. */
export function buildExplorerSelectionMessage(filePath: string, selectedText: string): string {
  const snippet = selectedText.trim();
  return `In @${filePath}:\n\n\`\`\`\n${snippet}\n\`\`\`\n\n`;
}

export function subscribeComposerPrefill(
  target: ComposerPrefillTarget,
  handler: (text: string) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<ComposerPrefillDetail>).detail;
    if (!detail || detail.target !== target) return;
    handler(detail.text);
  };

  window.addEventListener(COMPOSER_PREFILL_EVENT, listener);
  return () => window.removeEventListener(COMPOSER_PREFILL_EVENT, listener);
}

/** Wire direct-harness composer textareas to explorer Cmd+I prefill events. */
export function useDirectHarnessComposerPrefill(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  setText: (value: string) => void
): void {
  useEffect(() => {
    return subscribeComposerPrefill('direct-harness', (prefillText) => {
      setText(prefillText);
      setTimeout(() => textareaRef.current?.focus(), 0);
    });
  }, [setText, textareaRef]);
}
