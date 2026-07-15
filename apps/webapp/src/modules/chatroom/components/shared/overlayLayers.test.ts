import { describe, expect, it } from 'vitest';

import { Z_FLOATING, Z_LAYOUT_CHROME, Z_MODAL, Z_PANEL } from './overlayLayers';

describe('overlayLayers', () => {
  it('exports expected Tailwind z-index classes', () => {
    expect(Z_LAYOUT_CHROME).toBe('z-30');
    expect(Z_PANEL).toBe('z-40');
    expect(Z_MODAL).toBe('z-50');
    expect(Z_FLOATING).toBe('z-[100]');
  });
});
