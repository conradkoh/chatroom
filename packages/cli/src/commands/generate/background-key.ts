/**
 * Border flood-fill background keying.
 *
 * A tile's background is one colour estimated from its outer 1-px border. The
 * flood fill only reaches background-coloured pixels connected to the border,
 * so an item's interior stays opaque even when it contains background-coloured
 * pixels. Everything is deterministic and dependency-free: no fs, pngjs, or
 * clock is used here.
 */

export const DEFAULT_TOLERANCE = 24;
export const DEFAULT_MIN_AREA_PERCENT = 0.5;
// fallow-ignore-next-line unused-export
export const BORDER_NOISE_REFUSAL_RATIO = 0.02;

export interface KeyOptions {
  tolerance: number;
  minAreaPercent: number;
  allowEdgeContent: boolean;
}

export interface KeyedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
}

export type KeyResult =
  | { ok: false; message: string }
  | {
      ok: true;
      data: Uint8Array;
      background: [number, number, number];
      components: number;
      regions: KeyedRegion[];
      foregroundPixels: number;
      foregroundRatio: number;
      droppedSpecks: { count: number; pixels: number };
      enclosedBackgroundLike: number;
      contentBox: { x: number; y: number; width: number; height: number };
      centerOffset: { x: number; y: number };
      touchesTileEdge: boolean;
    };

interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

interface Component {
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// fallow-ignore-next-line complexity
function borderCoordinates(width: number, height: number): [number, number][] {
  const coordinates: [number, number][] = [];
  for (let x = 0; x < width; x += 1) {
    coordinates.push([x, 0]);
    if (height > 1) coordinates.push([x, height - 1]);
  }
  for (let y = 1; y < height - 1; y += 1) {
    coordinates.push([0, y]);
    if (width > 1) coordinates.push([width - 1, y]);
  }
  return coordinates;
}

// fallow-ignore-next-line complexity
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/** Visit all 8 neighbours that fall inside the image. */
// fallow-ignore-next-line complexity
function forEachNeighbour(
  index: number,
  width: number,
  height: number,
  visit: (neighbour: number) => void
): void {
  const x = index % width;
  const y = Math.floor(index / width);
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      visit(ny * width + nx);
    }
  }
}

/** Per-channel median of the opaque outer-border pixels. */
// fallow-ignore-next-line complexity
function borderBackground(
  image: Image,
  border: [number, number][]
): [number, number, number] | null {
  const red: number[] = [];
  const green: number[] = [];
  const blue: number[] = [];
  for (const [x, y] of border) {
    const offset = (y * image.width + x) * 4;
    if ((image.data[offset + 3] ?? 0) === 0) continue;
    red.push(image.data[offset] ?? 0);
    green.push(image.data[offset + 1] ?? 0);
    blue.push(image.data[offset + 2] ?? 0);
  }
  if (red.length === 0) return null;
  return [median(red), median(green), median(blue)];
}

function chebyshev(image: Image, offset: number, background: [number, number, number]): number {
  return Math.max(
    Math.abs((image.data[offset] ?? 0) - background[0]),
    Math.abs((image.data[offset + 1] ?? 0) - background[1]),
    Math.abs((image.data[offset + 2] ?? 0) - background[2])
  );
}

interface PreparedBackground {
  background: [number, number, number];
  distance: Uint8Array;
}

/** Estimate the border colour and refuse a border that is mostly artwork. */
// fallow-ignore-next-line complexity
function prepareBackground(
  image: Image,
  border: [number, number][],
  tolerance: number,
  allowEdgeContent: boolean
): { ok: false; message: string } | ({ ok: true } & PreparedBackground) {
  const background = borderBackground(image, border);
  if (background === null) return { ok: false, message: 'tile border is fully transparent' };

  const pixelCount = image.width * image.height;
  const distance = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    distance[index] =
      (image.data[offset + 3] ?? 0) === 0 ? 0 : chebyshev(image, offset, background);
  }
  let borderDiffers = 0;
  for (const [x, y] of border) {
    const index = y * image.width + x;
    const offset = index * 4;
    if ((image.data[offset + 3] ?? 0) === 0) continue;
    if ((distance[index] ?? 0) > tolerance) borderDiffers += 1;
  }
  if (!allowEdgeContent && borderDiffers / border.length > BORDER_NOISE_REFUSAL_RATIO) {
    const percent = ((borderDiffers / border.length) * 100).toFixed(1).replace(/\.0$/, '');
    return {
      ok: false,
      message: `${percent}% of the tile border differs from the background estimate (${background.join(',')}): artwork touches the border or the background is not uniform. Re-slice or regenerate, or pass --allow-edge-content.`,
    };
  }
  return { ok: true, background, distance };
}

/** Flood the background-reachable pixels from the border, 4-connected. */
// fallow-ignore-next-line complexity
function floodBackground(
  image: Image,
  distance: Uint8Array,
  border: [number, number][],
  tolerance: number
): Uint8Array {
  const { width, height, data } = image;
  const isBackground = new Uint8Array(width * height);
  const stack: number[] = [];
  // fallow-ignore-next-line complexity
  const pushIfReachable = (index: number): void => {
    if (isBackground[index] === 1) return;
    const offset = index * 4;
    if ((data[offset + 3] ?? 0) !== 0 && (distance[index] ?? 0) > tolerance) return;
    isBackground[index] = 1;
    stack.push(index);
  };
  for (const [x, y] of border) pushIfReachable(y * width + x);
  while (stack.length > 0) {
    const index = stack.pop() ?? 0;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) pushIfReachable(index - 1);
    if (x < width - 1) pushIfReachable(index + 1);
    if (y > 0) pushIfReachable(index - width);
    if (y < height - 1) pushIfReachable(index + width);
  }
  return isBackground;
}

/** Remaining opaque pixels that the flood fill could not reach. */
// fallow-ignore-next-line complexity
function candidateMask(image: Image, isBackground: Uint8Array): Uint8Array {
  const candidates = new Uint8Array(isBackground.length);
  for (let index = 0; index < candidates.length; index += 1) {
    if (isBackground[index] === 1) continue;
    if ((image.data[index * 4 + 3] ?? 0) === 0) {
      isBackground[index] = 1;
      continue;
    }
    candidates[index] = 1;
  }
  return candidates;
}

/** 8-connected components of the candidate mask, in deterministic scan order. */
// fallow-ignore-next-line complexity
function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number
): { components: Component[]; labels: Int32Array } {
  const seen = new Uint8Array(mask.length);
  const labels = new Int32Array(mask.length);
  const components: Component[] = [];
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    const label = components.length + 1;
    const stack = [start];
    seen[start] = 1;
    labels[start] = label;
    const component: Component = { area: 0, x0: width, y0: height, x1: -1, y1: -1 };
    while (stack.length > 0) {
      const index = stack.pop() ?? 0;
      const x = index % width;
      const y = Math.floor(index / width);
      component.area += 1;
      component.x0 = Math.min(component.x0, x);
      component.y0 = Math.min(component.y0, y);
      component.x1 = Math.max(component.x1, x);
      component.y1 = Math.max(component.y1, y);
      forEachNeighbour(index, width, height, (neighbour) => {
        if (mask[neighbour] === 1 && seen[neighbour] === 0) {
          seen[neighbour] = 1;
          labels[neighbour] = label;
          stack.push(neighbour);
        }
      });
    }
    components.push(component);
  }
  return { components, labels };
}

/** A kept pixel's alpha is feathered only where it touches keyed background. */
function featheredAlpha(distance: number, tolerance: number): number {
  if (tolerance <= 0) return 255;
  const ramp = Math.min(1, Math.max(0, (distance - tolerance) / tolerance));
  return Math.round(255 * ramp);
}

function hasBackgroundNeighbour(
  background: Uint8Array,
  index: number,
  width: number,
  height: number
): boolean {
  let found = false;
  forEachNeighbour(index, width, height, (neighbour) => {
    if (background[neighbour] === 1) found = true;
  });
  return found;
}

interface KeptMasks {
  kept: Component[];
  dropped: Component[];
  droppedPixels: number;
}

/** Drop components below the configured minimum area and mark them background. */
// fallow-ignore-next-line complexity
function dropSpecks(
  candidates: Uint8Array,
  isBackground: Uint8Array,
  components: Component[],
  labels: Int32Array,
  minArea: number
): KeptMasks {
  const kept: Component[] = [];
  const dropped: Component[] = [];
  const droppedLabels = new Set<number>();
  components.forEach((component, index) => {
    if (component.area >= minArea) kept.push(component);
    else {
      dropped.push(component);
      droppedLabels.add(index + 1);
    }
  });
  if (droppedLabels.size === 0) return { kept, dropped, droppedPixels: 0 };

  // Clear only pixels whose own label belongs to a dropped component. Clearing
  // the component's bounding box would erase any kept item inside that box.
  let droppedPixels = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    if (!droppedLabels.has(labels[index] ?? 0)) continue;
    if (candidates[index] === 1) {
      candidates[index] = 0;
      isBackground[index] = 1;
      droppedPixels += 1;
    }
  }
  return { kept, dropped, droppedPixels };
}

interface RenderStats {
  data: Uint8Array;
  foregroundPixels: number;
  enclosedBackgroundLike: number;
  touchesTileEdge: boolean;
  contentBox: { x: number; y: number; width: number; height: number };
}

/** Paint the alpha channel and measure the kept pixels. */
// fallow-ignore-next-line complexity
function renderKept(
  image: Image,
  candidates: Uint8Array,
  isBackground: Uint8Array,
  distance: Uint8Array,
  tolerance: number
): RenderStats {
  const { width, height, data } = image;
  const output = new Uint8Array(data.length);
  output.set(data);
  let foregroundPixels = 0;
  let enclosedBackgroundLike = 0;
  let touchesTileEdge = false;
  let contentX0 = width;
  let contentY0 = height;
  let contentX1 = -1;
  let contentY1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      if (candidates[index] !== 1) {
        output[offset + 3] = 0;
        continue;
      }
      const pixelDistance = distance[index] ?? 0;
      const edge = hasBackgroundNeighbour(isBackground, index, width, height);
      // Enclosed background-like pixels stay opaque: the flood fill could not
      // reach them, so they are part of the item (for example a ring's hole).
      output[offset + 3] =
        pixelDistance <= tolerance || !edge ? 255 : featheredAlpha(pixelDistance, tolerance);
      if ((output[offset + 3] ?? 0) > 0) foregroundPixels += 1;
      if (
        (x === 0 || y === 0 || x === width - 1 || y === height - 1) &&
        (output[offset + 3] ?? 0) > 0
      ) {
        touchesTileEdge = true;
      }
      if (pixelDistance <= tolerance && x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        enclosedBackgroundLike += 1;
      }
      contentX0 = Math.min(contentX0, x);
      contentY0 = Math.min(contentY0, y);
      contentX1 = Math.max(contentX1, x);
      contentY1 = Math.max(contentY1, y);
    }
  }
  return {
    data: output,
    foregroundPixels,
    enclosedBackgroundLike,
    touchesTileEdge,
    contentBox: {
      x: contentX0,
      y: contentY0,
      width: contentX1 - contentX0 + 1,
      height: contentY1 - contentY0 + 1,
    },
  };
}

function buildKeySuccess(args: {
  data: Uint8Array;
  background: [number, number, number];
  components: Component[];
  dropped: Component[];
  droppedPixels: number;
  stats: RenderStats;
  pixelCount: number;
  width: number;
  height: number;
}): Extract<KeyResult, { ok: true }> {
  const { stats, width, height } = args;
  const regions: KeyedRegion[] = [...args.components]
    .sort((a, b) => b.area - a.area)
    .slice(0, 8)
    .map((component) => ({
      x: component.x0,
      y: component.y0,
      width: component.x1 - component.x0 + 1,
      height: component.y1 - component.y0 + 1,
      area: component.area,
    }));
  const centreX = (stats.contentBox.x + stats.contentBox.x + stats.contentBox.width - 1) / 2;
  const centreY = (stats.contentBox.y + stats.contentBox.y + stats.contentBox.height - 1) / 2;
  return {
    ok: true,
    data: args.data,
    background: args.background,
    components: args.components.length,
    regions,
    foregroundPixels: stats.foregroundPixels,
    foregroundRatio: stats.foregroundPixels / args.pixelCount,
    droppedSpecks: { count: args.dropped.length, pixels: args.droppedPixels },
    enclosedBackgroundLike: stats.enclosedBackgroundLike,
    contentBox: stats.contentBox,
    centerOffset: { x: centreX - (width - 1) / 2, y: centreY - (height - 1) / 2 },
    touchesTileEdge: stats.touchesTileEdge,
  };
}

/**
 * Key one RGBA tile. Expected failures are returned as `{ ok: false }` so the
 * caller can name the file without exception plumbing.
 */
// fallow-ignore-next-line complexity
export function keyBackground(image: Image, opts: KeyOptions): KeyResult {
  const { width, height, data } = image;
  const pixelCount = width * height;
  if (data.length !== pixelCount * 4) {
    return { ok: false, message: 'image data is not RGBA' };
  }
  const border = borderCoordinates(width, height);
  const prepared = prepareBackground(image, border, opts.tolerance, opts.allowEdgeContent);
  if (!prepared.ok) return prepared;

  const isBackground = floodBackground(image, prepared.distance, border, opts.tolerance);
  const candidates = candidateMask(image, isBackground);
  const minArea = Math.ceil((opts.minAreaPercent / 100) * pixelCount);
  const { components, labels } = labelComponents(candidates, width, height);
  const { kept, dropped, droppedPixels } = dropSpecks(
    candidates,
    isBackground,
    components,
    labels,
    minArea
  );
  if (kept.length === 0) {
    return {
      ok: false,
      message: 'no foreground found; the tile is empty or --tolerance is too high',
    };
  }

  const stats = renderKept(image, candidates, isBackground, prepared.distance, opts.tolerance);
  if (stats.foregroundPixels === 0) {
    return {
      ok: false,
      message: 'no foreground found after keying; the tile is empty or --tolerance is too high',
    };
  }
  if (stats.contentBox.width <= 0 || stats.contentBox.height <= 0) {
    return { ok: false, message: 'no foreground found; the content box is empty' };
  }
  return buildKeySuccess({
    data: stats.data,
    background: prepared.background,
    components: kept,
    dropped,
    droppedPixels,
    stats,
    pixelCount,
    width,
    height,
  });
}
