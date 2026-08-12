import { describe, expect, it } from 'vitest';

import {
  Z_AGENT_SIDEBAR_MOBILE_BACKDROP,
  Z_AGENT_SIDEBAR_MOBILE_PANEL,
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
    expect(Z_AGENT_SIDEBAR_MOBILE_BACKDROP).toBe('z-50');
    expect(Z_AGENT_SIDEBAR_MOBILE_PANEL).toBe('z-[55]');
    expect(Z_MODAL).toBe('z-50');
    expect(Z_FLOATING).toBe('z-[100]');
    expect(Z_CONFIRMATION).toBe('z-[110]');
  });
});

describe('mobile agent sidebar stacking', () => {
  it('stacks above jump-to-new-messages chip', () => {
    const backdropZ = 50;
    const panelZ = 55;
    expect(backdropZ).toBeGreaterThanOrEqual(JUMP_TO_NEW_MESSAGES_Z_INDEX);
    expect(panelZ).toBeGreaterThan(JUMP_TO_NEW_MESSAGES_Z_INDEX);
    expect(panelZ).toBeGreaterThan(backdropZ);
  });
});
