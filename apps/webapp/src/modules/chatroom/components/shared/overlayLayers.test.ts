import { describe, expect, it } from 'vitest';

import {
  Z_CONFIRMATION,
  Z_FLOATING,
  Z_LAYOUT_CHROME,
  Z_MODAL,
  Z_PANEL,
} from './overlayLayers';
import { JUMP_TO_NEW_MESSAGES_Z_INDEX } from '../timeline/timelineVirtualizerConfig';

describe('overlayLayers', () => {
  it('exports expected Tailwind z-index classes', () => {
    expect(Z_LAYOUT_CHROME).toBe('z-30');
    expect(Z_PANEL).toBe('z-40');
    expect(Z_MODAL).toBe('z-50');
    expect(Z_FLOATING).toBe('z-[100]');
    expect(Z_CONFIRMATION).toBe('z-[110]');
  });
});

function readZIndex(layer: string): number {
  const match = /^z-(?:\[(\d+)\]|(\d+))$/.exec(layer);
  if (!match) throw new Error(`Unsupported z-index class: ${layer}`);
  return Number(match[1] ?? match[2]);
}

it('keeps content overlays below sidebar chrome and modals above panels', () => {
  expect(JUMP_TO_NEW_MESSAGES_Z_INDEX).toBeLessThan(readZIndex(Z_LAYOUT_CHROME));
  expect(readZIndex(Z_LAYOUT_CHROME)).toBeLessThan(readZIndex(Z_PANEL));
  expect(readZIndex(Z_PANEL)).toBeLessThan(readZIndex(Z_MODAL));
});
