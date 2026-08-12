/**
 * Model variant encoding + server model catalog — unit tests.
 */

import { describe, expect, test } from 'vitest';

import { CLAUDE_MODEL_VARIANT_COMBINATIONS, CLAUDE_SPAWN_ALIASES } from './claude.model-variants';
import { CODEX_MODEL_VARIANT_COMBINATIONS } from './codex-sdk.model-variants';
import { HARNESS_MODEL_CATALOG, type CatalogBackedHarness } from './model-catalog';
import {
  ModelVariantParseError,
  ModelVariantValidationError,
  PLAIN_MODEL_SCHEMA,
  decodeModelVariant,
  encodeModelVariant,
  expandModelVariantCatalog,
  formatModelVariantParamsSuffix,
  validateModelVariantParams,
} from './model-variant';

describe('decodeModelVariant', () => {
  test('plain model id decodes to empty params', () => {
    expect(decodeModelVariant('gpt-5.6-sol')).toEqual({ model: 'gpt-5.6-sol', params: {} });
  });

  test('single param variant decodes', () => {
    expect(decodeModelVariant('gpt-5.6-sol[reasoning=high]')).toEqual({
      model: 'gpt-5.6-sol',
      params: { reasoning: 'high' },
    });
  });

  test('multi-param variant decodes in order', () => {
    expect(decodeModelVariant('gpt-5.6-sol[reasoning=high,param2=<value2>]')).toEqual({
      model: 'gpt-5.6-sol',
      params: { reasoning: 'high', param2: '<value2>' },
    });
  });

  test('hyphenated keys and placeholder values decode', () => {
    expect(decodeModelVariant('m[web-search=true]')).toEqual({
      model: 'm',
      params: { 'web-search': 'true' },
    });
  });

  test.each([
    '',
    '[reasoning=high]',
    'gpt[ ]',
    'gpt[]',
    'gpt[reasoning]',
    'gpt[=high]',
    'gpt[reasoning=]',
    'gpt[reasoning=high,]',
    'gpt[reasoning=high,reasoning=low]',
    'gpt[reasoning=high]extra',
    'gpt[reasoning=high][more=x]',
    'gpt[a b=c]',
    'gpt[reasoning=high,param2=with=equals]',
    'gpt[reasoning=high,param2=with,comma]',
    'gpt[reasoning=high,param2=with]bracket]',
  ])('rejects malformed %j', (input) => {
    expect(() => decodeModelVariant(input)).toThrow(ModelVariantParseError);
  });
});

describe('encodeModelVariant', () => {
  test('inverse of decode for plain and variant forms', () => {
    expect(encodeModelVariant('gpt-5.6-sol')).toBe('gpt-5.6-sol');
    expect(encodeModelVariant('gpt-5.6-sol', { reasoning: 'high' })).toBe(
      'gpt-5.6-sol[reasoning=high]'
    );
    expect(encodeModelVariant('gpt-5.6-sol', { reasoning: 'high', param2: '<value2>' })).toBe(
      'gpt-5.6-sol[reasoning=high,param2=<value2>]'
    );
  });

  test('round-trips through decode', () => {
    const encoded = 'gpt-5.6-sol[reasoning=high,param2=<value2>]';
    const { model, params } = decodeModelVariant(encoded);
    expect(encodeModelVariant(model, params)).toBe(encoded);
  });
});

describe('validateModelVariantParams', () => {
  test('accepts every codex allowed combination', () => {
    // Plain id (no params) is itself an allowed combination.
    expect(
      validateModelVariantParams(
        decodeModelVariant('gpt-5.6-sol'),
        CODEX_MODEL_VARIANT_COMBINATIONS
      ).params
    ).toEqual({});
    for (const level of ['none', 'low', 'medium', 'high', 'xhigh'] as const) {
      const variant = validateModelVariantParams(
        decodeModelVariant(`gpt-5.6-sol[reasoning=${level}]`),
        CODEX_MODEL_VARIANT_COMBINATIONS
      );
      expect(variant.params.reasoning).toBe(level);
    }
  });

  test('rejects params from another harness vocabulary', () => {
    expect(() =>
      validateModelVariantParams(
        decodeModelVariant('gpt-5.6-sol[thinking=high]'),
        CODEX_MODEL_VARIANT_COMBINATIONS
      )
    ).toThrow(ModelVariantValidationError);
  });

  test('rejects disallowed values', () => {
    expect(() =>
      validateModelVariantParams(
        decodeModelVariant('gpt-5.6-sol[reasoning=ultra]'),
        CODEX_MODEL_VARIANT_COMBINATIONS
      )
    ).toThrow(ModelVariantValidationError);
  });

  test('rejects unsupported combinations (extra param alongside a supported one)', () => {
    expect(() =>
      validateModelVariantParams(
        decodeModelVariant('gpt-5.6-sol[reasoning=high,param2=<value2>]'),
        CODEX_MODEL_VARIANT_COMBINATIONS
      )
    ).toThrow(ModelVariantValidationError);
  });

  test('plain ids only for harnesses without variant params', () => {
    expect(validateModelVariantParams(decodeModelVariant('auto'), PLAIN_MODEL_SCHEMA)).toEqual({
      model: 'auto',
      params: {},
    });
    expect(() =>
      validateModelVariantParams(decodeModelVariant('auto[composer=2.5]'), PLAIN_MODEL_SCHEMA)
    ).toThrow(ModelVariantValidationError);
  });
});

describe('HARNESS_MODEL_CATALOG', () => {
  /** Per-harness schemas: codex has its own vocabulary; others are plain ids only. */
  const HARNESS_SCHEMAS: Record<CatalogBackedHarness, typeof PLAIN_MODEL_SCHEMA> = {
    'codex-sdk': CODEX_MODEL_VARIANT_COMBINATIONS,
    copilot: PLAIN_MODEL_SCHEMA,
    cursor: PLAIN_MODEL_SCHEMA,
    claude: CLAUDE_MODEL_VARIANT_COMBINATIONS,
    'claude-sdk': CLAUDE_MODEL_VARIANT_COMBINATIONS,
  };

  test('every catalog entry decodes and validates against its harness schema', () => {
    for (const harness of Object.keys(HARNESS_MODEL_CATALOG) as CatalogBackedHarness[]) {
      for (const entry of HARNESS_MODEL_CATALOG[harness]) {
        // Strict parse + combination check: a catalog typo fails here instead
        // of at daemon spawn.
        const decoded = decodeModelVariant(entry);
        expect(() => validateModelVariantParams(decoded, HARNESS_SCHEMAS[harness])).not.toThrow();
      }
    }
  });

  test('codex catalog contains plain ids and every reasoning level per model', () => {
    const codex = HARNESS_MODEL_CATALOG['codex-sdk'];
    for (const base of [
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.5',
      'gpt-5.4-mini',
    ]) {
      expect(codex).toContain(base);
      for (const level of ['none', 'low', 'medium', 'high', 'xhigh']) {
        expect(codex).toContain(`${base}[reasoning=${level}]`);
      }
    }
  });

  test('formats suffixes and expands catalogs', () => {
    expect(formatModelVariantParamsSuffix({ effort: 'none' })).toBe('[effort=none]');
    expect(formatModelVariantParamsSuffix({})).toBe('');
    expect(expandModelVariantCatalog(['model'], [{}, { effort: 'none' }])).toEqual([
      'model',
      'model[effort=none]',
    ]);
  });

  test('copilot and cursor entries are plain ids (no variants)', () => {
    for (const harness of ['copilot', 'cursor'] as const) {
      for (const entry of HARNESS_MODEL_CATALOG[harness]) {
        expect(decodeModelVariant(entry).params).toEqual({});
      }
    }
  });

  test('claude catalog lists canonical base ids only (no spawn aliases)', () => {
    for (const harness of ['claude', 'claude-sdk'] as const) {
      const catalog = HARNESS_MODEL_CATALOG[harness];
      const baseIds = catalog.map((entry) => decodeModelVariant(entry).model);
      expect(new Set(baseIds).size).toBe(4);
      for (const alias of CLAUDE_SPAWN_ALIASES) {
        expect(baseIds).not.toContain(alias);
      }
      expect(baseIds).toContain('claude-sonnet-4-6');
      expect(baseIds).toContain('claude-haiku-4-5');
    }
  });
});
