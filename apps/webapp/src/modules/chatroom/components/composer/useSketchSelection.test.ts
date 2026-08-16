import { describe, expect, it } from 'vitest';
import { SKETCH_MIN_SELECTION_CSS_PX } from './sketchSelectionTypes';
describe('useSketchSelection', () => { it('defines the minimum marquee contract', () => { expect(SKETCH_MIN_SELECTION_CSS_PX).toBe(4); }); });
