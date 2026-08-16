export function buildSketchFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `sketch-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`;
}
