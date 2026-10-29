/**
 * Generate 3D — the standalone preview page for a package.
 *
 * The page is written beside `<base>.zip` as `<base>.html` and previews both
 * variants the package holds: the master (full-resolution mesh and textures) and
 * the web variant (simplified mesh, scaled-down textures). The web variant is
 * selected by default because it is the smaller file and the one the package
 * expects a browser to load. Both GLBs are embedded as base64 `data:` URIs so
 * the page opens from `file://` with no server and no sibling files.
 *
 * Three lighting modes sit beside the variant switch: Studio is the viewer's
 * default, Directional uses a generated sun-only environment map, and Unlit
 * rewrites the runtime materials so the base-colour map is emissive. The unlit
 * mode deliberately uses model-viewer's runtime material API instead of a
 * second GLB, so the page never embeds the model twice.
 *
 * The Checks panel lists advisory warnings computed from the written master.
 *
 * The viewer is the only remote asset, pinned to one published version and
 * guarded by a subresource-integrity hash, so a changed CDN response is refused
 * by the browser rather than executed.
 *
 * Every value that comes from a model, a prompt, a request, or a user-chosen
 * name is escaped before it reaches the document. A prompt is arbitrary text,
 * including HTML, and the page must render it as text rather than parse it.
 */

import type { AssetCheck } from './checks.js';

export interface PreviewHtmlInput {
  /** Rendered package base name; also the page title. */
  title: string;
  modelId: string;
  prompt: string | null;
  requestId: string;
  /** The master GLB bytes, the full-resolution variant. */
  masterGlb: Uint8Array;
  /** The web variant bytes, the scaled-down variant. */
  webGlb: Uint8Array;
  webSha256: string;
  webTriangles: number;
  masterTriangles: number;
  masterBytes: number;
  webBytes: number;
  /** The master's file name inside the zip, for example `chest.glb`. */
  masterZipEntry: string;
  /** `"<base>.zip"`, the sibling archive that holds the master. */
  zipName: string;
  /** Advisory checks for the Checks panel. */
  checks: AssetCheck[];
  /** Equirectangular PNG that lights the directional mode. */
  directionalEnvironmentPng: Uint8Array;
}

/** The five characters that can break out of text or an attribute value. */
function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Pinned viewer build, with the sha384 of that exact file. */
const MODEL_VIEWER_URL =
  'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';
const MODEL_VIEWER_SRI = 'sha384-Ftcjj/GNLxPvzNDftO/oryXB9aGxsGZY9JGqsXG0uUKgQDl9RfDgsx9NJ/4IVNPe';

/** Equirectangular environment size; 512×256 is enough for one small sun. */
const ENVIRONMENT_WIDTH = 512;
const ENVIRONMENT_HEIGHT = 256;

/** Sun disc radius in pixels; about 8° across at this equirectangular width. */
const SUN_RADIUS_PX = 10;

const PANEL_STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #111318; color: #e6e8ec;
         font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  h1 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
  .caption, .checks { margin: 0 0 16px; padding: 12px 16px; border: 1px solid #2a2f3a;
             border-radius: 8px; background: #171a21; }
  .caption dl { display: grid; grid-template-columns: max-content 1fr;
                gap: 4px 16px; margin: 0; }
  .caption dt { color: #9aa3b2; }
  .caption dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-size: 12px; word-break: break-word; }
  .checks h2 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
  .checks ul { margin: 0; padding-left: 20px; }
  .checks li { color: #f0c674; }
  .checks .ok { margin: 0; color: #9aa3b2; }
  .variants, .lighting { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
  .variants { margin-bottom: 8px; }
  .variant, .lighting-option { padding: 8px 12px; border: 1px solid #2a2f3a;
             border-radius: 8px; background: #171a21; color: #e6e8ec;
             font: inherit; cursor: pointer; }
  .variant[aria-pressed="true"], .lighting-option[aria-pressed="true"] {
             border-color: #6b8afd; background: #1d2436; }
  .variant:focus-visible, .lighting-option:focus-visible {
             outline: 2px solid #6b8afd; outline-offset: 2px; }
  model-viewer { width: 100%; height: 70vh; min-height: 420px;
                 background: #0b0d11; border: 1px solid #2a2f3a; border-radius: 8px; }
  .note { color: #9aa3b2; font-size: 12px; }
`;

/** Whole bytes with thousands separators, so 4.4 MB reads as 4,467,864. */
function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString('en-US')} bytes`;
}

/** Triangle counts with thousands separators. */
function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

/** One caption row; both sides are escaped by the caller. */
function captionRow(label: string, value: string): string {
  return `    <dt>${label}</dt><dd>${value}</dd>`;
}

/** One variant switch button; the label is escaped by the caller. */
function variantButton(variant: 'master' | 'web', pressed: boolean, label: string): string {
  return `  <button type="button" class="variant" data-variant="${variant}" aria-pressed="${pressed}">${label}</button>`;
}

/** One lighting switch button. */
function lightingButton(mode: 'studio' | 'directional' | 'unlit', pressed: boolean): string {
  const label = mode === 'studio' ? 'Studio' : mode === 'directional' ? 'Directional' : 'Unlit';
  return `  <button type="button" class="lighting-option" data-lighting="${mode}" aria-pressed="${pressed}">${label}</button>`;
}

/** The Checks panel: escaped messages, or the all-clear line. */
function checksPanel(checks: readonly AssetCheck[]): string {
  if (checks.length === 0) {
    return `  <p class="ok">No issues found.</p>`;
  }
  const items = checks
    .map(
      (check) => `    <li data-check="${escapeHtml(check.id)}">${escapeHtml(check.message)}</li>`
    )
    .join('\n');
  return `  <ul>\n${items}\n  </ul>`;
}

/** A GLB as the `data:` URI model-viewer accepts from `file://`. */
function glbDataUri(glb: Uint8Array): string {
  return `data:model/gltf-binary;base64,${Buffer.from(glb).toString('base64')}`;
}

/** True when a texel lies inside the sun disc. */
function isSunTexel(x: number, y: number): boolean {
  const dx = x - Math.round(ENVIRONMENT_WIDTH * 0.75);
  const dy = y - Math.round(ENVIRONMENT_HEIGHT * 0.7);
  return dx * dx + dy * dy <= SUN_RADIUS_PX * SUN_RADIUS_PX;
}

/**
 * Build the sun-only equirectangular environment used by the directional mode.
 *
 * The map is black (no ambient light) with one small white disc high on the
 * front half, so the model is lit from roughly one direction. It is generated
 * once by the caller and embedded; no network asset is involved.
 */
export async function directionalEnvironmentPng(): Promise<Uint8Array> {
  const { default: sharp } = await import('sharp');
  const pixels = new Uint8Array(ENVIRONMENT_WIDTH * ENVIRONMENT_HEIGHT * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index + 3] = 255;
    const texel = index / 4;
    const x = texel % ENVIRONMENT_WIDTH;
    const y = Math.floor(texel / ENVIRONMENT_WIDTH);
    if (!isSunTexel(x, y)) continue;
    pixels[index] = 255;
    pixels[index + 1] = 255;
    pixels[index + 2] = 255;
  }

  const png = await sharp(Buffer.from(pixels), {
    raw: { width: ENVIRONMENT_WIDTH, height: ENVIRONMENT_HEIGHT, channels: 4 },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/**
 * Render the full page.
 *
 * The returned string is complete HTML with no external assets except the
 * model-viewer module itself.
 */
export function renderPreviewHtml(input: PreviewHtmlInput): string {
  const title = escapeHtml(input.title);
  const prompt = input.prompt === null ? 'Not specified.' : escapeHtml(input.prompt);
  const masterDataUri = glbDataUri(input.masterGlb);
  const webDataUri = glbDataUri(input.webGlb);
  const directionalEnvironment = `data:image/png;base64,${Buffer.from(
    input.directionalEnvironmentPng
  ).toString('base64')}`;

  const rows = [
    captionRow('Model id', escapeHtml(input.modelId)),
    captionRow('Prompt', prompt),
    captionRow('Request id', escapeHtml(input.requestId)),
    captionRow(
      'Triangles',
      `${formatCount(input.masterTriangles)} master / ${formatCount(input.webTriangles)} web`
    ),
    captionRow(
      'Size',
      `${formatBytes(input.masterBytes)} master / ${formatBytes(input.webBytes)} web`
    ),
    captionRow('Web SHA-256', escapeHtml(input.webSha256)),
    captionRow(
      'Master file',
      `${escapeHtml(input.masterZipEntry)} (in ${escapeHtml(input.zipName)})`
    ),
  ].join('\n');

  const masterLabel = `Full resolution (master, ${formatBytes(input.masterBytes)}, ${formatCount(
    input.masterTriangles
  )} triangles)`;
  const webLabel = `Scaled down (web, ${formatBytes(input.webBytes)}, ${formatCount(
    input.webTriangles
  )} triangles)`;
  const variantButtons = [
    variantButton('master', false, masterLabel),
    variantButton('web', true, webLabel),
  ].join('\n');
  const lightingButtons = [
    lightingButton('studio', true),
    lightingButton('directional', false),
    lightingButton('unlit', false),
  ].join('\n');
  const checks = checksPanel(input.checks);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — 3D preview</title>
<style>${PANEL_STYLE}</style>
</head>
<body>
<h1>${title}</h1>
<div class="caption">
  <dl>
${rows}
  </dl>
</div>
<section class="checks">
  <h2>Checks</h2>
${checks}
</section>
<div class="variants" role="group" aria-label="Variant">
${variantButtons}
</div>
<div class="lighting" role="group" aria-label="Lighting">
${lightingButtons}
</div>
<model-viewer
  src="${webDataUri}"
  data-master-src="${masterDataUri}"
  data-directional-environment="${directionalEnvironment}"
  alt="${title} preview"
  camera-controls
  auto-rotate
  shadow-intensity="1"
  exposure="1"
  touch-action="pan-y"></model-viewer>
<p class="note">Switch between the full-resolution master and the scaled-down web variant, and between Studio, Directional, and Unlit lighting. Drag to orbit, scroll to zoom.</p>
<script>
  const viewer = document.querySelector('model-viewer');
  const variants = {
    master: viewer.getAttribute('data-master-src'),
    web: viewer.getAttribute('src'),
  };
  const directionalEnvironment = viewer.getAttribute('data-directional-environment');
  let lighting = 'studio';

  const unlitState = new WeakMap();

  function materialsOf() {
    const model = viewer.model;
    return model && model.materials ? model.materials : [];
  }

  function setUnlit(enabled) {
    for (const material of materialsOf()) {
      const pbr = material.pbrMetallicRoughness;
      if (!pbr || !material.emissiveTexture) continue;
      const saved = unlitState.get(material);
      if (enabled) {
        const state = saved || {
          baseColorFactor: [...pbr.baseColorFactor],
          metallicFactor: pbr.metallicFactor,
          roughnessFactor: pbr.roughnessFactor,
          emissiveFactor: [...material.emissiveFactor],
          emissiveStrength: material.emissiveStrength,
          emissiveTexture: material.emissiveTexture.texture,
        };
        unlitState.set(material, state);
        const base = pbr.baseColorTexture ? pbr.baseColorTexture.texture : null;
        pbr.setBaseColorFactor([0, 0, 0, 1]);
        pbr.setMetallicFactor(0);
        pbr.setRoughnessFactor(1);
        material.setEmissiveStrength(1);
        material.emissiveTexture.setTexture(base);
        material.setEmissiveFactor(
          base ? [1, 1, 1] : state.baseColorFactor.slice(0, 3)
        );
      } else if (saved) {
        pbr.setBaseColorFactor(saved.baseColorFactor);
        pbr.setMetallicFactor(saved.metallicFactor);
        pbr.setRoughnessFactor(saved.roughnessFactor);
        material.setEmissiveFactor(saved.emissiveFactor);
        material.setEmissiveStrength(saved.emissiveStrength);
        material.emissiveTexture.setTexture(saved.emissiveTexture);
        unlitState.delete(material);
      }
    }
  }

  function applyLighting() {
    if (lighting === 'directional') {
      viewer.setAttribute('environment-image', directionalEnvironment);
      viewer.setAttribute('exposure', '20');
    } else {
      viewer.removeAttribute('environment-image');
      viewer.setAttribute('exposure', '1');
    }
    setUnlit(lighting === 'unlit');
  }

  for (const button of document.querySelectorAll('button[data-variant]')) {
    button.addEventListener('click', () => {
      const name = button.getAttribute('data-variant');
      viewer.setAttribute('src', variants[name]);
      for (const other of document.querySelectorAll('button[data-variant]')) {
        other.setAttribute('aria-pressed', String(other === button));
      }
    });
  }
  for (const button of document.querySelectorAll('button[data-lighting]')) {
    button.addEventListener('click', () => {
      lighting = button.getAttribute('data-lighting');
      for (const other of document.querySelectorAll('button[data-lighting]')) {
        other.setAttribute('aria-pressed', String(other === button));
      }
      applyLighting();
    });
  }
  viewer.addEventListener('load', applyLighting);
  applyLighting();
</script>
<script
  type="module"
  src="${MODEL_VIEWER_URL}"
  integrity="${MODEL_VIEWER_SRI}"
  crossorigin="anonymous"></script>
</body>
</html>
`;
}
