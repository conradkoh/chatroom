import { describe, expect, it } from 'vitest';
import { rgbaToHex, samplePixelHex } from './sketchColorSample';
describe('sketchColorSample', () => { it('converts rgba to hex and samples opaque pixels', () => { expect(rgbaToHex(1, 16, 255)).toBe('#0110ff'); const data = { width: 1, height: 1, data: new Uint8ClampedArray([1, 16, 255, 255]) } as ImageData; expect(samplePixelHex(data, 0, 0)).toBe('#0110ff'); data.data[3] = 0; expect(samplePixelHex(data, 0, 0)).toBeNull(); }); });
