import { describe, expect, it } from 'vitest'; import { imageDataPixelsEqual, sketchCanvasHasInk } from './sketchCanvasSnapshot';
describe('sketchCanvasSnapshot',()=>{it('detects ink and compares pixels',()=>{const a=new ImageData(1,1);expect(sketchCanvasHasInk(a)).toBe(false);a.data[0]=1;expect(sketchCanvasHasInk(a)).toBe(true);expect(imageDataPixelsEqual(a,a)).toBe(true);});});
