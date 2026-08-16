import { SKETCH_CANVAS_COLORS } from './sketchConstants';
export type SketchHistorySnapshot = { imageData: ImageData; hasContent: boolean };
function parse(hex: string): [number,number,number] { return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]; }
export function sketchCanvasHasInk(data: ImageData, background=SKETCH_CANVAS_COLORS.background) { const [r,g,b]=parse(background); for(let i=0;i<data.data.length;i+=4) if(data.data[i]!==r||data.data[i+1]!==g||data.data[i+2]!==b) return true; return false; }
export function imageDataPixelsEqual(a: ImageData,b: ImageData) { if(a.width!==b.width||a.height!==b.height)return false; return a.data.every((v,i)=>v===b.data[i]); }
export function captureBackingSnapshot(ctx: CanvasRenderingContext2D,hasContent:boolean):SketchHistorySnapshot { return { imageData:ctx.getImageData(0,0,ctx.canvas.width,ctx.canvas.height),hasContent }; }
