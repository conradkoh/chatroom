import { describe, expect, it } from 'vitest';

import { isModelEffectivelyHidden } from './modelVisibility';

describe('isModelEffectivelyHidden', () => {
  it('does not hide variants when only base model is in hiddenModels (provider visible)', () => {
    expect(isModelEffectivelyHidden('model', 'model', new Set(['model']), new Set())).toBe(true);
    expect(
      isModelEffectivelyHidden('model[effort=high]', 'model', new Set(['model']), new Set())
    ).toBe(false);
  });

  it('un-hides variants when base model is exception and provider is hidden', () => {
    expect(isModelEffectivelyHidden('model', 'model', new Set(['model']), new Set(['model']))).toBe(
      false
    );
    expect(
      isModelEffectivelyHidden(
        'model[effort=high]',
        'model',
        new Set(['model']),
        new Set(['model'])
      )
    ).toBe(false);
  });

  it('hides only tagless anthropic catalog model, not effort variants', () => {
    const hiddenModels = new Set(['anthropic/claude-sonnet-4-6']);
    expect(
      isModelEffectivelyHidden('anthropic/claude-sonnet-4-6', 'anthropic', hiddenModels, new Set())
    ).toBe(true);
    expect(
      isModelEffectivelyHidden(
        'anthropic/claude-sonnet-4-6[effort=high]',
        'anthropic',
        hiddenModels,
        new Set()
      )
    ).toBe(false);
  });
});
