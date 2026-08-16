import { describe, expect, it } from 'vitest';
import { decideTwoFingerMode, panScrollFromPointer } from './sketchViewportPan';
describe('sketchViewportPan', () => { it('translates scroll opposite pointer movement', () => expect(panScrollFromPointer({ clientX: 10, clientY: 20, scrollLeft: 100, scrollTop: 50 }, 30, 10)).toEqual({ scrollLeft: 80, scrollTop: 60 })); it('chooses pan for stable fingers and zoom for changed distance', () => { expect(decideTwoFingerMode(100, 102)).toBe('pan'); expect(decideTwoFingerMode(100, 120)).toBe('zoom'); }); });
