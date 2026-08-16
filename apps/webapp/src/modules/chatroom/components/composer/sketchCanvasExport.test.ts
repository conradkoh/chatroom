import { describe, expect, it, vi } from 'vitest';
import { applyTransparentBackground } from './sketchCanvasExport';
class TestImageData { width:number; height:number; data:Uint8ClampedArray; constructor(w:number,h:number){this.width=w;this.height=h;this.data=new Uint8ClampedArray(w*h*4);} }
vi.stubGlobal('ImageData', TestImageData);
describe('applyTransparentBackground', () => { it('clears white alpha and keeps colored alpha', () => { const data={width:2,height:1,data:new Uint8ClampedArray([255,255,255,255,255,0,0,255])} as ImageData; const out=applyTransparentBackground(data); expect(Array.from(out.data)).toEqual([255,255,255,0,255,0,0,255]); }); });
