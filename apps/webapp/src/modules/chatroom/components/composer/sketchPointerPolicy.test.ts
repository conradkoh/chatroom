import { describe, expect, it, vi } from 'vitest';

import {
  createSketchPenSession,
  isSketchPalm,
  recordSketchPointer,
  recordSketchPointerAndDropPalm,
} from './sketchPointerPolicy';

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

  it('drops an active touch gesture when a pen pointer arrives', () => {
    const session = createSketchPenSession();
    const gesture = { pointerType: 'touch' };
    const drop = vi.fn();
    expect(recordSketchPointerAndDropPalm(session, 'pen', gesture, drop)).toBe(true);
    expect(drop).toHaveBeenCalledTimes(1);
    expect(drop).toHaveBeenCalledWith(gesture);
    expect(session.penSeen).toBe(true);
  });

  it('does not drop an active pen gesture', () => {
    const session = createSketchPenSession();
    const drop = vi.fn();
    expect(recordSketchPointerAndDropPalm(session, 'pen', { pointerType: 'pen' }, drop)).toBe(
      false
    );
    expect(drop).not.toHaveBeenCalled();
  });

  it('returns false with no active gesture', () => {
    const session = createSketchPenSession();
    const drop = vi.fn();
    expect(recordSketchPointerAndDropPalm(session, 'pen', null, drop)).toBe(false);
    expect(drop).not.toHaveBeenCalled();
  });

  it('does not drop a touch gesture when no pen has been seen', () => {
    const session = createSketchPenSession();
    const drop = vi.fn();
    expect(recordSketchPointerAndDropPalm(session, 'touch', { pointerType: 'touch' }, drop)).toBe(
      false
    );
    expect(drop).not.toHaveBeenCalled();
    expect(session.penSeen).toBe(false);
  });
});
