/**
 * Preview page tests.
 *
 * Two properties matter: the page is self-contained (the web GLB round-trips
 * through the data URI) and no user-controlled text can escape into markup.
 */

import { describe, expect, it } from 'vitest';

import { renderPreviewHtml, type PreviewHtmlInput } from './preview-html.js';

/** A minimal GLB: magic "glTF", version 2, then a few payload bytes. */
const WEB_GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00, 7, 8, 9, 10]);
const WEB_SHA256 = 'c3b41eb0c19ffb1a753ac5f9463264e612d08ca9c586c08a239954897931a1cd';

const INPUT: PreviewHtmlInput = {
  title: 'chest-20261028-011838',
  modelId: 'meshy/v7.1/text-to-3d',
  prompt: 'a low-poly wooden treasure chest with iron bands, game prop',
  requestId: '01a18014-bd89-74b0-a036-735c60221501',
  webGlb: WEB_GLB,
  webSha256: WEB_SHA256,
  webTriangles: 27_438,
  masterTriangles: 27_438,
  masterBytes: 4_467_864,
  webBytes: 1_391_260,
  masterZipEntry: 'chest.glb',
  zipName: 'chest-20261028-011838.zip',
};

/** The base64 payload of the viewer's `src` attribute. */
function embeddedBase64(html: string): string {
  const match = html.match(
    /<model-viewer\s+src="data:model\/gltf-binary;base64,([A-Za-z0-9+/=]+)"/
  );
  if (match === null) throw new Error('no embedded GLB data URI found');
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
    expect(html).toMatch(/integrity="sha384-[A-Za-z0-9+/=]+"/);
    expect(html).toContain('crossorigin="anonymous"');
  });

  it('embeds the web variant byte-for-byte', () => {
    const html = renderPreviewHtml(INPUT);
    const decoded = Buffer.from(embeddedBase64(html), 'base64');

    expect(decoded.equals(Buffer.from(WEB_GLB))).toBe(true);
    expect(decoded.subarray(0, 4).toString('latin1')).toBe('glTF');
  });

  it('shows the request id, the triangle counts, the sizes, and the zip name', () => {
    const html = renderPreviewHtml(INPUT);

    expect(html).toContain(INPUT.requestId);
    expect(html).toContain('27,438 master / 27,438 web');
    expect(html).toContain('4,467,864 bytes master / 1,391,260 bytes web');
    expect(html).toContain(INPUT.zipName);
    expect(html).toContain(INPUT.webSha256);
    expect(html).toContain('Full-resolution master is in chest-20261028-011838.zip.');
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
});
