function idx(w: number, x: number, y: number) { return (y * w + x) * 4; }
function rgbaAt(data: ImageData, x: number, y: number): [number, number, number, number] { const i = idx(data.width, x, y); return [data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3]]; }
function rgbaEqual(a: [number, number, number, number], b: [number, number, number, number]) { return a.every((v, i) => v === b[i]); }
export function hexToRgba(hex: string, alpha = 255): [number, number, number, number] { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), alpha]; }
export function floodFillImageData(data: ImageData, startX: number, startY: number, fill: [number, number, number, number]): ImageData {
  if (startX < 0 || startY < 0 || startX >= data.width || startY >= data.height) return data;
  const target = rgbaAt(data, startX, startY); if (rgbaEqual(target, fill)) return data;
  const out = new ImageData(data.width, data.height); out.data.set(data.data);
  const stack: [number, number][] = [[startX, startY]];
  while (stack.length) { const [x, y] = stack.pop()!; if (x < 0 || y < 0 || x >= data.width || y >= data.height || !rgbaEqual(rgbaAt(out, x, y), target)) continue; const i = idx(data.width, x, y); out.data[i] = fill[0]; out.data[i + 1] = fill[1]; out.data[i + 2] = fill[2]; out.data[i + 3] = fill[3]; stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
  return out;
}
