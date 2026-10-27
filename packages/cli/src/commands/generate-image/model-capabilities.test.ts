import { describe, expect, it } from 'vitest';

import {
  describeConstraints,
  FLUX_2_FLASH_EDIT_MODEL,
  FLUX_2_FLASH_MODEL,
  getModelCapability,
} from './model-capabilities.js';

const MODEL_IDS = [FLUX_2_FLASH_MODEL, FLUX_2_FLASH_EDIT_MODEL] as const;

describe('model capabilities', () => {
  it('classifies the two FLUX 2 Flash ids', () => {
    expect(getModelCapability(FLUX_2_FLASH_MODEL)?.task).toBe('text-to-image');
    expect(getModelCapability(FLUX_2_FLASH_EDIT_MODEL)?.task).toBe('image-edit');
  });

  it('marks aspect_ratio and negative_prompt unsupported on both models', () => {
    for (const id of [FLUX_2_FLASH_MODEL, FLUX_2_FLASH_EDIT_MODEL]) {
      const params = getModelCapability(id)?.params;
      expect(params?.aspect_ratio.support).toBe('unsupported');
      expect(params?.negative_prompt.support).toBe('unsupported');
    }
  });

  it('only supports image_urls on the edit model', () => {
    expect(getModelCapability(FLUX_2_FLASH_MODEL)?.params.image_urls.support).toBe('unsupported');
    expect(getModelCapability(FLUX_2_FLASH_EDIT_MODEL)?.params.image_urls.support).toBe(
      'supported'
    );
  });

  it('records each model default image_size', () => {
    expect(getModelCapability(FLUX_2_FLASH_MODEL)?.params.image_size).toMatchObject({
      support: 'supported',
      default: 'landscape_4_3',
    });
    expect(getModelCapability(FLUX_2_FLASH_EDIT_MODEL)?.params.image_size).toMatchObject({
      support: 'supported',
      default: 'square_hd',
    });
  });

  it('returns undefined for an unknown model id', () => {
    expect(getModelCapability('x/y')).toBeUndefined();
  });

  it('names only full FLUX 2 Flash models', () => {
    for (const id of MODEL_IDS) {
      expect(getModelCapability(id)?.name).not.toMatch(/FLUX\.2|FLUX 2(?! Flash)/);
    }
  });
});

describe('describeConstraints', () => {
  it('reports negative_prompt as unsupported from --input', () => {
    const disclosures = describeConstraints(
      FLUX_2_FLASH_MODEL,
      { prompt: 'x', negative_prompt: 'blurry' },
      {}
    );

    expect(disclosures).toContainEqual({
      kind: 'unsupported',
      key: 'negative_prompt',
      source: 'input',
      message: expect.stringContaining('no negative prompt'),
    });
  });

  it('reports --aspect-ratio as unsupported from the flag', () => {
    const disclosures = describeConstraints(
      FLUX_2_FLASH_MODEL,
      { prompt: 'x', aspect_ratio: '1:1' },
      { aspectRatio: '1:1' }
    );

    expect(disclosures).toContainEqual({
      kind: 'unsupported',
      key: 'aspect_ratio',
      source: 'flag',
      message: expect.stringContaining('image_size'),
    });
  });

  it('reports a key missing from the table as unknown', () => {
    const disclosures = describeConstraints(
      FLUX_2_FLASH_MODEL,
      { prompt: 'x', guidance_scale: 3.5 },
      {}
    );

    expect(disclosures).toContainEqual({
      kind: 'unknown',
      key: 'guidance_scale',
      message: expect.stringContaining('not in the CLI'),
    });
  });

  it.each([
    [FLUX_2_FLASH_MODEL, 'landscape_4_3'],
    [FLUX_2_FLASH_EDIT_MODEL, 'square_hd'],
  ])('reports the unset image_size default for %s', (model, expectedDefault) => {
    const disclosures = describeConstraints(model, { prompt: 'x' }, {});

    expect(disclosures).toContainEqual({
      kind: 'default',
      key: 'image_size',
      message: expect.stringContaining(`model default ${expectedDefault}`),
    });
  });

  it('always includes the model notes', () => {
    const disclosures = describeConstraints(FLUX_2_FLASH_MODEL, { prompt: 'x' }, {});
    const capability = getModelCapability(FLUX_2_FLASH_MODEL);

    for (const note of capability?.notes ?? []) {
      expect(disclosures).toContainEqual({ kind: 'note', message: note });
    }
  });

  it('returns one note for an unknown model', () => {
    expect(describeConstraints('x/y', { prompt: 'x' }, {})).toEqual([
      {
        kind: 'note',
        message: 'The CLI has no capability data for x/y; no constraints were checked.',
      },
    ]);
  });
});
