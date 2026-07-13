import { describe, expect, it, vi } from 'vitest';

import {
  buildExplorerSelectionPrefill,
  dispatchComposerPrefill,
  dispatchComposerTextPrefill,
  subscribeComposerPrefill,
  subscribeComposerTextPrefill,
  type ComposerPrefillDetail,
} from './composerPrefill';

const COMPOSER_PREFILL_EVENT = 'chatroom:composer-prefill';

const samplePrefillDetail = (
  overrides?: Partial<ComposerPrefillDetail>
): ComposerPrefillDetail => ({
  target: 'messages',
  fileSource: 'src/foo.ts',
  selectedContent: 'const x = 1;',
  ...overrides,
});

describe('buildExplorerSelectionPrefill', () => {
  it('creates attachment and inline reference message body', () => {
    const result = buildExplorerSelectionPrefill('src/foo.ts', 'const x = 1;', []);
    expect(result.attachment.fileSource).toBe('src/foo.ts');
    expect(result.attachment.selectedContent).toBe('const x = 1;');
    expect(result.messageBody).toBe('[attachment: attachment-reference-001]');
  });

  it('increments reference when existing attachments present', () => {
    const result = buildExplorerSelectionPrefill('b.ts', 'y', ['attachment-reference-001']);
    expect(result.attachment.reference).toBe('attachment-reference-002');
    expect(result.messageBody).toBe('[attachment: attachment-reference-002]');
  });
});

describe('composer prefill events', () => {
  it('dispatches and delivers detail to subscriber', () => {
    const handler = vi.fn();
    const unsub = subscribeComposerPrefill(handler);

    const detail = samplePrefillDetail({ selectedContent: 'hello messages' });
    dispatchComposerPrefill(detail);

    expect(handler).toHaveBeenCalledWith(detail);

    unsub();
  });

  it('dispatches a CustomEvent with structured detail', () => {
    const listener = vi.fn();
    window.addEventListener(COMPOSER_PREFILL_EVENT, listener);

    const detail = samplePrefillDetail({ selectedContent: 'test' });
    dispatchComposerPrefill(detail);

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<ComposerPrefillDetail>;
    expect(event.detail).toEqual(detail);

    window.removeEventListener(COMPOSER_PREFILL_EVENT, listener);
  });

  it('dispatches and delivers plain text to text-prefill subscriber', () => {
    const handler = vi.fn();
    const unsub = subscribeComposerTextPrefill(handler);

    dispatchComposerTextPrefill('Run the deploy checklist');

    expect(handler).toHaveBeenCalledWith({
      target: 'messages',
      content: 'Run the deploy checklist',
    });

    unsub();
  });
});
