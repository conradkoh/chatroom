import { describe, expect, it } from 'vitest';
import { SKETCH_NUDGE_SHIFT_STEP_PX, SKETCH_NUDGE_STEP_PX } from './sketchConstants';
describe('sketch nudge constants', () => { it('uses 1px default and 10px with shift', () => { expect(SKETCH_NUDGE_STEP_PX).toBe(1); expect(SKETCH_NUDGE_SHIFT_STEP_PX).toBe(10); }); });
