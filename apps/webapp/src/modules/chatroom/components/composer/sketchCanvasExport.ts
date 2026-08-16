import { SKETCH_CANVAS_COLORS } from './sketchConstants';

function parseHex(hex: string): [number, number, number] { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
export function applyTransparentBackground(data: ImageData, background = SKETCH_CANVAS_COLORS.background): ImageData {
  const [r, g, b] = parseHex(background); const out = new ImageData(data.width, data.height);
  for (let i = 0; i < data.data.length; i += 4) { out.data[i] = data.data[i]; out.data[i + 1] = data.data[i + 1]; out.data[i + 2] = data.data[i + 2]; out.data[i + 3] = data.data[i] === r && data.data[i + 1] === g && data.data[i + 2] === b ? 0 : data.data[i + 3]; }
  return out;
}
export async function canvasToTransparentPngBlob(canvas: HTMLCanvasElement, background = SKETCH_CANVAS_COLORS.background): Promise<Blob | null> {
  const ctx = canvas.getContext('2d'); if (!ctx) return null;
  const transparent = applyTransparentBackground(ctx.getImageData(0, 0, canvas.width, canvas.height), background);
  const exportCanvas = document.createElement('canvas'); exportCanvas.width = canvas.width; exportCanvas.height = canvas.height;
  exportCanvas.getContext('2d')!.putImageData(transparent, 0, 0);
  return new Promise(resolve => exportCanvas.toBlob(resolve, 'image/png'));
}
