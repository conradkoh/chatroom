/**
 * Preview page tests.
 *
 * The properties that matter: the page is self-contained (both GLBs round-trip
 * through their data URIs), it defaults to the scaled-down web variant, and no
 * user-controlled text can escape into markup.
 */

import { describe, expect, it } from 'vitest';

import {
  directionalEnvironmentPng,
  renderPreviewHtml,
  type PreviewHtmlInput,
} from './preview-html.js';

/** A minimal GLB: magic "glTF", version 2, then a few payload bytes. */
const MASTER_GLB = new Uint8Array([
  0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 1, 2, 3, 4, 5, 6,
]);
const WEB_GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 7, 8, 9, 10]);
const WEB_SHA256 = 'c3b41eb0c19ffb1a753ac5f9463264e612d08ca9c586c08a239954897931a1cd';

const INPUT: PreviewHtmlInput = {
  title: 'chest-20261028-011838',
  modelId: 'meshy/v7.1/text-to-3d',
  prompt: 'a low-poly wooden treasure chest with iron bands, game prop',
  requestId: '01a18014-bd89-74b0-a036-735c60221501',
  masterGlb: MASTER_GLB,
  webGlb: WEB_GLB,
  webSha256: WEB_SHA256,
  webTriangles: 27_438,
  masterTriangles: 48_984,
  masterBytes: 4_467_864,
  webBytes: 1_391_260,
  masterZipEntry: 'chest.glb',
  zipName: 'chest-20261028-011838.zip',
  checks: [],
  directionalEnvironmentPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x01, 0x02, 0x03]),
};

/** The base64 payload of the viewer's `src` attribute (the web variant). */
function embeddedWebBase64(html: string): string {
  const match = html.match(
    /<model-viewer\s+src="data:model\/gltf-binary;base64,([A-Za-z0-9+/=]+)"/
  );
  if (match === null) throw new Error('no embedded web GLB data URI found');
  return match[1] as string;
}

/** The base64 payload of the viewer's `data-master-src` attribute. */
function embeddedMasterBase64(html: string): string {
  const match = html.match(/data-master-src="data:model\/gltf-binary;base64,([A-Za-z0-9+/=]+)"/);
  if (match === null) throw new Error('no embedded master GLB data URI found');
  return match[1] as string;
}

describe('renderPreviewHtml', () => {
  it('renders a model-viewer with controls and the pinned, SRI-guarded module', () => {
    const html = renderPreviewHtml(INPUT);

    expect(html).toContain('<model-viewer');
    expect(html).toContain('camera-controls');
    expect(html).toContain('auto-rotate');
    expect(html).toContain('shadow-intensity="1"');
    expect(html).toContain(
      'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js'
    );
    expect(html).toContain(
      'integrity="sha384-Ftcjj/GNLxPvzNDftO/oryXB9aGxsGZY9JGqsXG0uUKgQDl9RfDgsx9NJ/4IVNPe"'
    );
    expect(html).toContain('crossorigin="anonymous"');
  });

  it('embeds both variants as data URIs', () => {
    const html = renderPreviewHtml(INPUT);

    expect(html.split('data:model/gltf-binary;base64,').length - 1).toBe(2);
    expect(html).toContain(Buffer.from(MASTER_GLB).toString('base64'));
    expect(html).toContain(Buffer.from(WEB_GLB).toString('base64'));
  });

  it('round-trips the web variant byte-for-byte in the default src', () => {
    const html = renderPreviewHtml(INPUT);
    const decoded = Buffer.from(embeddedWebBase64(html), 'base64');

    expect(decoded.equals(Buffer.from(WEB_GLB))).toBe(true);
    expect(decoded.subarray(0, 4).toString('latin1')).toBe('glTF');
  });

  it('round-trips the master variant byte-for-byte in the alternate source', () => {
    const html = renderPreviewHtml(INPUT);
    const decoded = Buffer.from(embeddedMasterBase64(html), 'base64');

    expect(decoded.equals(Buffer.from(MASTER_GLB))).toBe(true);
    expect(decoded.subarray(0, 4).toString('latin1')).toBe('glTF');
  });

  it('offers a two-option switch that defaults to the web variant', () => {
    const html = renderPreviewHtml(INPUT);

    expect(html).toContain('role="group" aria-label="Variant"');
    expect(html).toContain('data-variant="master" aria-pressed="false"');
    expect(html).toContain('data-variant="web" aria-pressed="true"');
    expect(html).toContain('Full resolution (master, 4,467,864 bytes, 48,984 triangles)');
    expect(html).toContain('Scaled down (web, 1,391,260 bytes, 27,438 triangles)');
    expect(html).toContain("viewer.setAttribute('src', variants[name])");
  });

  it('shows the request id, the triangle counts, the sizes, and the zip name', () => {
    const html = renderPreviewHtml(INPUT);

    expect(html).toContain(INPUT.requestId);
    expect(html).toContain('48,984 master / 27,438 web');
    expect(html).toContain('4,467,864 bytes master / 1,391,260 bytes web');
    expect(html).toContain(INPUT.zipName);
    expect(html).toContain(INPUT.webSha256);
    expect(html).toContain('chest.glb (in chest-20261028-011838.zip)');
  });

  it('renders a null prompt as text, not an empty cell', () => {
    expect(renderPreviewHtml({ ...INPUT, prompt: null })).toContain('Not specified.');
  });

  it('escapes a prompt that contains markup and never emits it raw', () => {
    const hostile = '</script><img src=x onerror=alert(1)>';

    const html = renderPreviewHtml({ ...INPUT, prompt: hostile });

    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain(hostile);
    expect(html).not.toContain('<img src=x');
  });

  it('escapes the user-chosen title and zip name', () => {
    const html = renderPreviewHtml({
      ...INPUT,
      title: 'a&b<c>',
      zipName: 'x"y.zip',
      masterZipEntry: 'z<1>.glb',
    });

    expect(html).toContain('a&amp;b&lt;c&gt;');
    expect(html).toContain('x&quot;y.zip');
    expect(html).toContain('z&lt;1&gt;.glb');
    expect(html).not.toContain('a&b<c>');
  });

  it('offers Studio, Directional, and Unlit lighting with Studio selected', () => {
    const html = renderPreviewHtml(INPUT);

    expect(html).toContain('role="group" aria-label="Lighting"');
    expect(html).toContain('data-lighting="studio" aria-pressed="true"');
    expect(html).toContain('data-lighting="directional" aria-pressed="false"');
    expect(html).toContain('data-lighting="unlit" aria-pressed="false"');
  });

  it('embeds the directional environment as a PNG data URI', () => {
    const html = renderPreviewHtml(INPUT);
    const encoded = Buffer.from(INPUT.directionalEnvironmentPng).toString('base64');

    expect(html).toContain(`data-directional-environment="data:image/png;base64,${encoded}"`);
  });

  it('lists checks and escapes their messages', () => {
    const hostile = '</script><img src=x onerror=alert(1)>';
    const html = renderPreviewHtml({
      ...INPUT,
      checks: [
        {
          id: 'not-on-feet',
          severity: 'warning',
          materialIndex: null,
          message: hostile,
        },
      ],
    });

    expect(html).toContain('<h2>Checks</h2>');
    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain(hostile);
  });

  it('shows the all-clear when there are no checks', () => {
    expect(renderPreviewHtml(INPUT)).toContain('No issues found.');
  });

  it('uses the base colour factor as the unlit emissive tint', () => {
    const html = renderPreviewHtml(INPUT);

    expect(html).toContain('material.setEmissiveFactor(state.baseColorFactor.slice(0, 3))');
    expect(html).not.toContain('base ? [1, 1, 1]');
  });

  it('shows a checks note instead of warnings', () => {
    const html = renderPreviewHtml({
      ...INPUT,
      checksNote: 'Checks unavailable: <bad archive>',
    });

    expect(html).toContain('Checks unavailable: &lt;bad archive&gt;');
    expect(html).not.toContain('No issues found.');
  });

  it('generates a PNG for the directional environment', async () => {
    const png = await directionalEnvironmentPng();

    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
