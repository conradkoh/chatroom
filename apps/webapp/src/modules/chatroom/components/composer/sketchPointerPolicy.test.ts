import { describe, expect, it } from 'vitest';

import { createSketchPenSession, isSketchPalm, recordSketchPointer } from './sketchPointerPolicy';

describe('sketchPointerPolicy', () => {
  it('lets touch draw before any pen is seen', () => {
    const session = createSketchPenSession();
    expect(isSketchPalm(session, 'touch')).toBe(false);
  });

  it('treats touch as a palm once a pen is seen', () => {
    const session = createSketchPenSession();
    recordSketchPointer(session, 'pen');
    expect(isSketchPalm(session, 'touch')).toBe(true);
    expect(isSketchPalm(session, 'pen')).toBe(false);
    expect(isSketchPalm(session, 'mouse')).toBe(false);
    expect(isSketchPalm(session, '')).toBe(false);
    expect(isSketchPalm(session, undefined)).toBe(false);
  });

  it('does not mark pen seen for touch, mouse, empty or undefined pointer types', () => {
    const session = createSketchPenSession();
    recordSketchPointer(session, 'touch');
    recordSketchPointer(session, 'mouse');
    recordSketchPointer(session, '');
    recordSketchPointer(session, undefined);
    expect(session.penSeen).toBe(false);
  });
});
