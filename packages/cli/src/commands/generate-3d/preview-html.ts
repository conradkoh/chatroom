/**
 * Generate 3D — the standalone preview page for a package.
 *
 * The page is written beside `<base>.zip` as `<base>.html` and previews the
 * **web** variant, not the master: it is the smaller file, and it is the one the
 * package expects a browser to load. The GLB is embedded as a base64 `data:` URI
 * so the page opens from `file://` with no server and no sibling files.
 *
 * The viewer is the only remote asset, pinned to one published version and
 * guarded by a subresource-integrity hash, so a changed CDN response is refused
 * by the browser rather than executed.
 *
 * Every value that comes from a model, a prompt, a request, or a user-chosen
 * name is escaped before it reaches the document. A prompt is arbitrary text,
 * including HTML, and the page must render it as text rather than parse it.
 */

export interface PreviewHtmlInput {
  /** Rendered package base name; also the page title. */
  title: string;
  modelId: string;
  prompt: string | null;
  requestId: string;
  /** The web variant bytes; embedded as the viewer source. */
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

const PANEL_STYLE = `
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #111318; color: #e6e8ec;
         font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  h1 { margin: 0 0 16px; font-size: 18px; font-weight: 600; }
  .caption { margin: 0 0 16px; padding: 12px 16px; border: 1px solid #2a2f3a;
             border-radius: 8px; background: #171a21; }
  .caption dl { display: grid; grid-template-columns: max-content 1fr;
                gap: 4px 16px; margin: 0; }
  .caption dt { color: #9aa3b2; }
  .caption dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-size: 12px; word-break: break-word; }
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

/**
 * Render the full page.
 *
 * The returned string is complete HTML with no external assets except the
 * model-viewer module itself.
 */
export function renderPreviewHtml(input: PreviewHtmlInput): string {
  const title = escapeHtml(input.title);
  const prompt = input.prompt === null ? 'Not specified.' : escapeHtml(input.prompt);
  const dataUri = `data:model/gltf-binary;base64,${Buffer.from(input.webGlb).toString('base64')}`;

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
<model-viewer
  src="${dataUri}"
  alt="${title} preview"
  camera-controls
  auto-rotate
  shadow-intensity="1"
  exposure="1"
  touch-action="pan-y"></model-viewer>
<p class="note">Preview of the web variant. Full-resolution master is in ${escapeHtml(input.zipName)}. Drag to orbit, scroll to zoom.</p>
<script
  type="module"
  src="${MODEL_VIEWER_URL}"
  integrity="${MODEL_VIEWER_SRI}"
  crossorigin="anonymous"></script>
</body>
</html>
`;
}
