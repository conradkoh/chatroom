import type { SketchRect } from './sketchSelectionTypes';
export function canvasPointFromEvent(canvas: HTMLCanvasElement, e: PointerEvent, dpr: number) { const r=canvas.getBoundingClientRect(); return { x:((e.clientX-r.left)*(canvas.width/r.width))/dpr, y:((e.clientY-r.top)*(canvas.height/r.height))/dpr }; }
export function normalizeRect(x1:number,y1:number,x2:number,y2:number):SketchRect { return { x:Math.min(x1,x2), y:Math.min(y1,y2), width:Math.abs(x2-x1), height:Math.abs(y2-y1) }; }
export function toBackingRect(rect:SketchRect,dpr:number):SketchRect { return { x:Math.round(rect.x*dpr), y:Math.round(rect.y*dpr), width:Math.round(rect.width*dpr), height:Math.round(rect.height*dpr) }; }
export function pointInRect(px:number,py:number,r:SketchRect) { return px>=r.x&&px<=r.x+r.width&&py>=r.y&&py<=r.y+r.height; }
