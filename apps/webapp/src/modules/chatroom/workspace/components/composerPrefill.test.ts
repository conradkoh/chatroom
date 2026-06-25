import { describe, expect, it, vi } from 'vitest';

import {
  buildExplorerSelectionMessage,
  dispatchComposerPrefill,
  subscribeComposerPrefill,
  type ComposerPrefillDetail,
} from './composerPrefill';

const COMPOSER_PREFILL_EVENT = 'chatroom:composer-prefill';

describe('buildExplorerSelectionMessage', () => {
  it('includes file path and fenced selection', () => {
    const message = buildExplorerSelectionMessage('src/foo.ts', 'const x = 1;');
    expect(message).toContain('@src/foo.ts');
    expect(message).toContain('const x = 1;');
    expect(message).toMatch(/```[\s\S]*```/);
  });
});

describe('composer prefill events', () => {
  it('dispatches and routes by target', () => {
    const messagesHandler = vi.fn();
    const harnessHandler = vi.fn();

    const unsubMessages = subscribeComposerPrefill('messages', messagesHandler);
    const unsubHarness = subscribeComposerPrefill('direct-harness', harnessHandler);

    dispatchComposerPrefill({ text: 'hello messages', target: 'messages' });
    dispatchComposerPrefill({ text: 'hello harness', target: 'direct-harness' });

    expect(messagesHandler).toHaveBeenCalledWith('hello messages');
    expect(harnessHandler).toHaveBeenCalledWith('hello harness');
    expect(messagesHandler).not.toHaveBeenCalledWith('hello harness');

    unsubMessages();
    unsubHarness();
  });

  it('dispatches a CustomEvent with detail', () => {
    const listener = vi.fn();
    window.addEventListener(COMPOSER_PREFILL_EVENT, listener);

    dispatchComposerPrefill({ text: 'test', target: 'messages' });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0] as CustomEvent<ComposerPrefillDetail>;
    expect(event.detail).toEqual({ text: 'test', target: 'messages' });

    window.removeEventListener(COMPOSER_PREFILL_EVENT, listener);
  });
});
