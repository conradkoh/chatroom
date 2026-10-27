/**
 * Generate 3D model registry tests.
 *
 * The registry is the allowlist, so these tests pin the exact ids, the request
 * shapes (including fields that must be omitted), and the per-model output
 * adapters. No network is involved: fixtures are literal fal results.
 */

import { describe, expect, it } from 'vitest';

import {
  allowedGenerate3dModelIds,
  findGenerate3dModel,
  Generate3dError,
  GENERATE_3D_MODELS,
  type Generate3dModelSpec,
} from './model-registry.js';

const MESHY_TEXT = 'meshy/v7.1/text-to-3d';
const MESHY_IMAGE = 'meshy/v7.1/image-to-3d';
const HUNYUAN_RAPID = 'fal-ai/hunyuan-3d/v3.1/rapid/text-to-3d';
const TRELLIS_2 = 'fal-ai/trellis-2';

const MESHY_GLB = 'https://fal.test/meshy/model.glb';

const meshyResult = {
  model_glb: { url: MESHY_GLB, content_type: 'model/gltf-binary' },
  model_urls: { glb: { url: MESHY_GLB } },
  texture_urls: [
    {
      base_color: { url: 'https://fal.test/meshy/base-color.png' },
      normal: { url: 'https://fal.test/meshy/normal.png' },
      roughness: null,
      metallic: { url: 'https://fal.test/meshy/metallic.png' },
    },
  ],
};

const HUNYUAN_TEXTURE = 'https://fal.test/hunyuan/texture.png';

/** Hunyuan rapid puts the GLB under `model_urls.glb`, not `model_glb`. */
const hunyuanResult = {
  model_urls: {
    glb: { url: 'https://fal.test/hunyuan/model.glb' },
    texture: { url: HUNYUAN_TEXTURE },
  },
  texture: { url: HUNYUAN_TEXTURE },
};

const trellisResult = {
  model_glb: { url: 'https://fal.test/trellis/model.glb' },
};

function requireModel(id: string): Generate3dModelSpec {
  const model = findGenerate3dModel(id);
  if (model === undefined) throw new Error(`expected ${id} to be allowlisted`);
  return model;
}

function total(lines: readonly { usd: number }[]): number {
  return lines.reduce((sum, line) => sum + line.usd, 0);
}

describe('generate-3d model registry', () => {
  it('allowlists exactly the four v1 models', () => {
    expect(allowedGenerate3dModelIds()).toEqual([
      MESHY_TEXT,
      HUNYUAN_RAPID,
      MESHY_IMAGE,
      TRELLIS_2,
    ]);
  });

  it.each(allowedGenerate3dModelIds())('finds %s', (id) => {
    expect(findGenerate3dModel(id)?.id).toBe(id);
  });

  it('returns undefined for an unknown model', () => {
    expect(findGenerate3dModel('fal-ai/flux/dev')).toBeUndefined();
  });

  it.each(GENERATE_3D_MODELS)('$id records a commercial licence and page URL', (model) => {
    expect(model.licenseType).toBe('commercial');
    expect(model.pageUrl).toBe(`https://fal.ai/models/${model.id}`);
  });

  describe('input builders', () => {
    it('sends only the prompt for a text model', () => {
      const input = requireModel(MESHY_TEXT).buildInput({ prompt: '  a knight  ' });

      expect(input).toEqual({ prompt: 'a knight' });
      expect(input).not.toHaveProperty('image_url');
      // 'full' is the schema default (textured); sending it is unnecessary.
      expect(input).not.toHaveProperty('mode');
    });

    it('sends only the image URL for a Meshy image model', () => {
      const input = requireModel(MESHY_IMAGE).buildInput({
        imageUrl: 'https://example.test/hero.png',
      });

      expect(input).toEqual({ image_url: 'https://example.test/hero.png' });
      expect(input).not.toHaveProperty('prompt');
      // `should_texture` defaults to true; sending it is unnecessary.
      expect(input).not.toHaveProperty('should_texture');
    });

    it('sends the image URL and an explicit 1024 resolution for Trellis-2', () => {
      const input = requireModel(TRELLIS_2).buildInput({
        imageUrl: 'https://example.test/hero.png',
      });

      expect(input).toEqual({
        image_url: 'https://example.test/hero.png',
        resolution: 1024,
      });
    });

    it('sends only the prompt for Hunyuan rapid', () => {
      const input = requireModel(HUNYUAN_RAPID).buildInput({ prompt: 'a knight' });

      expect(input).toEqual({ prompt: 'a knight' });
      // Both default to false, so PBR maps and geometry-only are not requested.
      expect(input).not.toHaveProperty('enable_pbr');
      expect(input).not.toHaveProperty('enable_geometry');
    });

    it('rejects an empty prompt on a text model', () => {
      expect(() => requireModel(MESHY_TEXT).buildInput({ prompt: '   ' })).toThrow(Generate3dError);
    });

    it('rejects a missing image URL on an image model', () => {
      expect(() => requireModel(TRELLIS_2).buildInput({})).toThrow(Generate3dError);
    });
  });

  describe('output adapters', () => {
    it('reads the GLB and PBR texture files from a Meshy result', () => {
      const output = requireModel(MESHY_TEXT).readOutput(meshyResult);

      expect(output.glbUrl).toBe(MESHY_GLB);
      expect(output.textureUrls).toEqual([
        'https://fal.test/meshy/base-color.png',
        'https://fal.test/meshy/normal.png',
        'https://fal.test/meshy/metallic.png',
      ]);
    });

    it('reads the GLB and texture from a Hunyuan rapid result', () => {
      const output = requireModel(HUNYUAN_RAPID).readOutput(hunyuanResult);

      expect(output.glbUrl).toBe('https://fal.test/hunyuan/model.glb');
      expect(output.textureUrls).toEqual([HUNYUAN_TEXTURE]);
    });

    it('reads the GLB from a Trellis-2 result and reports embedded textures', () => {
      const output = requireModel(TRELLIS_2).readOutput(trellisResult);

      expect(output.glbUrl).toBe('https://fal.test/trellis/model.glb');
      expect(output.textureUrls).toEqual([]);
    });

    it.each([
      [MESHY_TEXT, meshyResult],
      [MESHY_IMAGE, meshyResult],
      [HUNYUAN_RAPID, hunyuanResult],
      [TRELLIS_2, trellisResult],
    ])('%s rejects a result with no GLB URL', (id, fixture) => {
      const {
        model_glb: _modelGlb,
        model_urls: _modelUrls,
        ...withoutGlb
      } = fixture as {
        model_glb?: unknown;
        model_urls?: unknown;
      };

      expect(() => requireModel(id).readOutput(withoutGlb)).toThrow(/no GLB/);
    });

    it.each([null, [], 'text', { model_glb: {} }])('rejects a malformed result %#', (fixture) => {
      expect(() => requireModel(MESHY_TEXT).readOutput(fixture)).toThrow(Generate3dError);
    });
  });

  describe('cost tables', () => {
    it('bills Meshy as the textured $1.20 request', () => {
      const lines = requireModel(MESHY_TEXT).cost().lines;

      expect(lines.map((line) => line.label)).toEqual(['base $0.80', 'textures +$0.40']);
      expect(total(lines)).toBeCloseTo(1.2, 3);
      expect(requireModel(MESHY_IMAGE).cost().lines).toEqual(lines);
    });

    it('bills Hunyuan rapid at $0.225 and excludes the optional PBR line', () => {
      const lines = requireModel(HUNYUAN_RAPID).cost().lines;

      expect(lines.map((line) => line.label)).toEqual([
        'base $0.225',
        'PBR +$0.15 (optional; not requested, excluded from the total)',
      ]);
      expect(total(lines)).toBeCloseTo(0.225, 3);
    });

    it('bills Trellis-2 at the resolution actually sent', () => {
      const lines = requireModel(TRELLIS_2).cost().lines;

      expect(lines.map((line) => line.label)).toEqual(['resolution 1024 $0.30']);
      expect(total(lines)).toBeCloseTo(0.3, 3);
    });
  });
});
