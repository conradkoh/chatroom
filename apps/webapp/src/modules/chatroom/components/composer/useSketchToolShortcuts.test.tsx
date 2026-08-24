import { describe, expect, it, vi } from 'vitest';

import { resolveSketchToolShortcut, SKETCH_ENABLED_TOOL_IDS } from './sketchTools';

const event = (key: string, target: EventTarget | null = document.body, modifiers = {}) => ({
  key,
  target,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('sketch tool shortcuts', () => {
  it('enables Brush while reserving Move and Select', () => {
    expect(resolveSketchToolShortcut(event('b'), SKETCH_ENABLED_TOOL_IDS)).toBe('brush');
    expect(resolveSketchToolShortcut(event('v'), SKETCH_ENABLED_TOOL_IDS)).toBeNull();
    expect(resolveSketchToolShortcut(event('m'), SKETCH_ENABLED_TOOL_IDS)).toBeNull();
    expect(resolveSketchToolShortcut(event('v'), ['move', 'select', 'brush'])).toBe('move');
    expect(resolveSketchToolShortcut(event('m'), ['move', 'select', 'brush'])).toBe('select');
  });

  it('ignores modifiers and editable targets', () => {
    expect(
      resolveSketchToolShortcut(
        event('b', document.body, { ctrlKey: true }),
        SKETCH_ENABLED_TOOL_IDS
      )
    ).toBeNull();
    for (const tag of ['input', 'textarea', 'select']) {
      const input = document.createElement(tag);
      expect(resolveSketchToolShortcut(event('b', input), SKETCH_ENABLED_TOOL_IDS)).toBeNull();
    }
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(resolveSketchToolShortcut(event('b', editable), SKETCH_ENABLED_TOOL_IDS)).toBeNull();
  });

  it('allows hook-like listener cleanup', () => {
    const listener = vi.fn((e: KeyboardEvent) =>
      resolveSketchToolShortcut(e, SKETCH_ENABLED_TOOL_IDS)
    );
    document.addEventListener('keydown', listener);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
    expect(listener).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', listener);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
