import { describe, expect, it } from 'vitest';
import { isModelEffectivelyHidden } from './modelVisibility';

describe('isModelEffectivelyHidden', () => {
  it('matches base-id overrides for variants', () => {
    expect(isModelEffectivelyHidden('model[effort=high]', 'model', new Set(['model']), new Set())).toBe(true);
    expect(isModelEffectivelyHidden('model[effort=high]', 'model', new Set(['model']), new Set(['model']))).toBe(false);
  });
});
