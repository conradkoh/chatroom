export type SketchRect = { x: number; y: number; width: number; height: number };
export type SketchFloatingSelection = { imageData: ImageData; bounds: SketchRect };
export type ResizeHandle = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w';
export const SKETCH_MIN_SELECTION_CSS_PX = 4;
