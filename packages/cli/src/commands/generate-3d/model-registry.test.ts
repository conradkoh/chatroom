/**
 * Generate 3D model registry tests.
 *
 * The registry is a capability table plus the generic passthrough, so these
 * tests pin the known ids, the request shapes (including fields that must be
 * omitted), the per-model output adapters, and the generic GLB search. No
 * network is involved: fixtures are literal fal results.
 */

import { describe, expect, it } from 'vitest';

import {
  Generate3dError,
  GENERATE_3D_MODELS,
  resolveGenerate3dModel,
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
  return resolveGenerate3dModel(id);
}

function costLines(model: Generate3dModelSpec): { label: string; usd: number }[] {
  const cost = model.cost();
  if (cost === undefined) throw new Error(`expected a price for ${model.id}`);
  return cost.lines;
}

function total(lines: readonly { usd: number }[]): number {
  return lines.reduce((sum, line) => sum + line.usd, 0);
}

describe('generate-3d model registry', () => {
  it('lists exactly the four specialised models', () => {
    expect(GENERATE_3D_MODELS.map((model) => model.id)).toEqual([
      MESHY_TEXT,
      HUNYUAN_RAPID,
      MESHY_IMAGE,
      TRELLIS_2,
    ]);
  });

  it.each([MESHY_TEXT, HUNYUAN_RAPID, MESHY_IMAGE, TRELLIS_2])('finds %s', (id) => {
    expect(resolveGenerate3dModel(id).id).toBe(id);
    expect(resolveGenerate3dModel(id).inputKind).toBeDefined();
  });

  it('falls back to a generic spec for an unknown model', () => {
    const model = resolveGenerate3dModel('fal-ai/some-future-model');

    expect(model.id).toBe('fal-ai/some-future-model');
    expect(model.inputKind).toBeUndefined();
    expect(model.cost()).toBeUndefined();
    expect(model.pageUrl).toBe('https://fal.ai/models/fal-ai/some-future-model');
    // No catalogue entry, so the registry makes no licence claim.
    expect(model.licenseType).toBe('unknown');
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

  describe('generic passthrough', () => {
    const FUTURE = 'fal-ai/some-future-model';

    it('maps --prompt and --input-image onto the conventional fields', () => {
      const model = requireModel(FUTURE);

      expect(model.buildInput({ prompt: ' a knight ' })).toEqual({ prompt: 'a knight' });
      expect(model.buildInput({ imageUrl: 'https://example.test/hero.png' })).toEqual({
        image_url: 'https://example.test/hero.png',
      });
    });

    it('merges --input over the conventional fields', () => {
      const model = requireModel(FUTURE);

      const input = model.buildInput({
        prompt: 'a knight',
        extraInput: { resolution: 512, prompt: 'a queen' },
      });

      expect(input).toEqual({ prompt: 'a queen', resolution: 512 });
    });

    it.each([
      ['model_glb', { model_glb: { url: 'https://fal.test/a/model.glb' } }],
      ['model_urls.glb', { model_urls: { glb: { url: 'https://fal.test/b/model.glb' } } }],
      [
        'a nested url',
        { output: { assets: [{ kind: 'mesh', url: 'https://fal.test/c/model.glb?v=2' }] } },
      ],
    ])('finds the GLB at %s', (_label, fixture) => {
      expect(requireModel(FUTURE).readOutput(fixture).glbUrl).toContain('/model.glb');
    });

    it('prefers model_glb over model_urls and a nested url', () => {
      const glbUrl = requireModel(FUTURE).readOutput({
        model_glb: { url: 'https://fal.test/first/model.glb' },
        model_urls: { glb: { url: 'https://fal.test/second/model.glb' } },
      }).glbUrl;

      expect(glbUrl).toBe('https://fal.test/first/model.glb');
    });

    it('names the model and the top-level keys when no GLB is present', () => {
      expect(() => requireModel(FUTURE).readOutput({ nope: 1, other: 2 })).toThrow(
        /no GLB for model fal-ai\/some-future-model.*nope, other/
      );
    });

    it('has no price data', () => {
      expect(requireModel(FUTURE).cost()).toBeUndefined();
    });
  });

  describe('cost tables', () => {
    it('bills Meshy as the textured $1.20 request', () => {
      const lines = costLines(requireModel(MESHY_TEXT));

      expect(lines.map((line) => line.label)).toEqual(['base $0.80', 'textures +$0.40']);
      expect(total(lines)).toBeCloseTo(1.2, 3);
      expect(costLines(requireModel(MESHY_IMAGE))).toEqual(lines);
    });

    it('bills Hunyuan rapid at $0.225 and excludes the optional PBR line', () => {
      const lines = costLines(requireModel(HUNYUAN_RAPID));

      expect(lines.map((line) => line.label)).toEqual([
        'base $0.225',
        'PBR +$0.15 (optional; not requested, excluded from the total)',
      ]);
      expect(total(lines)).toBeCloseTo(0.225, 3);
    });

    it('bills Trellis-2 at the resolution actually sent', () => {
      const lines = costLines(requireModel(TRELLIS_2));

      expect(lines.map((line) => line.label)).toEqual(['resolution 1024 $0.30']);
      expect(total(lines)).toBeCloseTo(0.3, 3);
    });
  });
});
