import { describe, expect, it, vi } from 'vitest';
import { floodFillImageData, hexToRgba } from './sketchFloodFill';
class TestImageData { width:number; height:number; data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }
vi.stubGlobal('ImageData', TestImageData);
describe('floodFillImageData', () => { it('fills only the connected matching region', () => { const red=[255,0,0,255], white=[255,255,255,255]; const a=new Uint8ClampedArray([...red,...red,...red,...red,...white,...red,...red,...red,...red]); const out=floodFillImageData({width:3,height:3,data:a} as ImageData,1,1,hexToRgba('#0000ff')); expect(Array.from(out.data.slice(16,20))).toEqual([0,0,255,255]); expect(Array.from(out.data.slice(0,4))).toEqual(red); }); });
