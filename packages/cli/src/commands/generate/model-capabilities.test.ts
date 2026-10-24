import { describe, expect, it } from 'vitest';

import {
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
