import { describe, expect, it } from 'vitest';

import {
  getBaseModelId,
  getModelProviderKey,
  isModelHidden,
  normalizeModelFilter,
  selectModel,
  UNPREFIXED_PROVIDER_KEY,
} from './modelSelection';

describe('cursor-sdk blacklist semantics', () => {
  it('normalizes legacy sentinel and hides only blacklisted model', () => {
    const filter = normalizeModelFilter({ hiddenModels: ['composer-2.5'], hiddenProviders: [UNPREFIXED_PROVIDER_KEY] });
    expect(filter).toEqual({ hiddenModels: ['composer-2.5'], hiddenProviders: [] });
    expect(isModelHidden('composer-2.5', filter)).toBe(true);
    expect(isModelHidden('claude-4.5-sonnet', filter)).toBe(false);
  });
});
import { TEST_MODEL_OPENCODE, TEST_MODEL_OPENCODE_ALT } from '../../../test/test-models';

// ─── getModelProviderKey ────────────────────────────────────────────

describe('getModelProviderKey', () => {
  it('uses base model id for unprefixed bare slugs', () => {
    expect(getModelProviderKey('gpt-5.4-high')).toBe('gpt-5.4-high');
    expect(getModelProviderKey('composer-2.5')).toBe('composer-2.5');
  });

  it('uses base model id for variant-encoded unprefixed models', () => {
    expect(getModelProviderKey('sonnet[effort=high]')).toBe('sonnet');
    expect(getModelProviderKey('gpt-5.6-terra[reasoning=high]')).toBe('gpt-5.6-terra');
  });

  it('returns prefix before slash for provider/model IDs', () => {
    expect(getModelProviderKey('openai/gpt-4')).toBe('openai');
    expect(getModelProviderKey(TEST_MODEL_OPENCODE)).toBe('opencode');
    expect(getModelProviderKey('openrouter/deepseek/deepseek-v4-pro-0813')).toBe('openrouter');
  });
});

describe('getBaseModelId', () => {
  it('strips variant suffix', () => {
    expect(getBaseModelId('sonnet[effort=high]')).toBe('sonnet');
  });

  it('returns input when not a variant', () => {
    expect(getBaseModelId('openai/gpt-4')).toBe('openai/gpt-4');
  });
});

// ─── isModelHidden ──────────────────────────────────────────────────

describe('isModelHidden', () => {
  it('returns false when filter is null', () => {
    expect(isModelHidden('openai/gpt-4', null)).toBe(false);
  });

  it('returns false when filter is undefined', () => {
    expect(isModelHidden('openai/gpt-4', undefined)).toBe(false);
  });

  it('returns false when filter has no hidden items', () => {
    expect(isModelHidden('openai/gpt-4', { hiddenModels: [], hiddenProviders: [] })).toBe(false);
  });

  it('hides a model listed in hiddenModels (provider visible)', () => {
    const filter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: [] };
    expect(isModelHidden('openai/gpt-4', filter)).toBe(true);
  });

  it('does not hide a model NOT listed in hiddenModels (provider visible)', () => {
    const filter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: [] };
    expect(isModelHidden('openai/gpt-3.5', filter)).toBe(false);
  });

  it('hides all models from a hidden provider', () => {
    const filter = { hiddenModels: [], hiddenProviders: ['openai'] };
    expect(isModelHidden('openai/gpt-4', filter)).toBe(true);
    expect(isModelHidden('openai/gpt-3.5', filter)).toBe(true);
  });

  it('un-hides a model explicitly listed when its provider is hidden', () => {
    const filter = { hiddenModels: ['openai/gpt-4'], hiddenProviders: ['openai'] };
    // openai provider hidden, but gpt-4 is in hiddenModels → exception → visible
    expect(isModelHidden('openai/gpt-4', filter)).toBe(false);
    // gpt-3.5 is NOT in exceptions → still hidden
    expect(isModelHidden('openai/gpt-3.5', filter)).toBe(true);
  });

  it('does not hide models from a different provider', () => {
    const filter = { hiddenModels: [], hiddenProviders: ['openai'] };
    expect(isModelHidden(TEST_MODEL_OPENCODE, filter)).toBe(false);
  });

  it('hides all unprefixed models when sentinel provider is hidden', () => {
    const filter = { hiddenModels: [], hiddenProviders: [UNPREFIXED_PROVIDER_KEY] };
    expect(isModelHidden('gpt-5.4-high', filter)).toBe(true);
    expect(isModelHidden('composer-2.5', filter)).toBe(true);
  });

  it('un-hides an unprefixed model listed as exception when sentinel is hidden', () => {
    const filter = {
      hiddenModels: ['gpt-5.4-high'],
      hiddenProviders: [UNPREFIXED_PROVIDER_KEY],
    };
    expect(isModelHidden('gpt-5.4-high', filter)).toBe(false);
    expect(isModelHidden('composer-2.5', filter)).toBe(true);
  });

  it('un-hides variant models when base model is listed as exception under sentinel', () => {
    const filter = {
      hiddenModels: ['sonnet'],
      hiddenProviders: [UNPREFIXED_PROVIDER_KEY],
    };
    expect(isModelHidden('sonnet', filter)).toBe(false);
    expect(isModelHidden('sonnet[effort=high]', filter)).toBe(false);
    expect(isModelHidden('opus[effort=high]', filter)).toBe(true);
  });
});

// ─── selectModel ────────────────────────────────────────────────────

describe('selectModel', () => {
  const allModels = [
    'openai/gpt-4',
    'openai/gpt-3.5',
    TEST_MODEL_OPENCODE,
    TEST_MODEL_OPENCODE_ALT,
  ];

  describe('edge cases', () => {
    it('returns null when no harness selected', () => {
      expect(
        selectModel({
          selectedHarness: null,
          availableModels: allModels,
          visibleModels: allModels,
        })
      ).toBeNull();
    });

    it('returns null when no models available', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: [],
          visibleModels: [],
        })
      ).toBeNull();
    });
  });

  describe('priority 1: explicit user choice', () => {
    it('selects the explicit user choice even if hidden (not in visibleModels)', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: [TEST_MODEL_OPENCODE, TEST_MODEL_OPENCODE_ALT], // openai models hidden
          userChoice: 'openai/gpt-4', // hidden but explicitly chosen
        })
      ).toBe('openai/gpt-4');
    });

    it('ignores user choice if model no longer available', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: [TEST_MODEL_OPENCODE],
          visibleModels: [TEST_MODEL_OPENCODE],
          userChoice: 'openai/gpt-4', // not in availableModels
        })
      ).toBe(TEST_MODEL_OPENCODE);
    });
  });

  describe('priority 2: machine config model', () => {
    it('selects machine config model when visible', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: allModels,
          machineConfigModel: TEST_MODEL_OPENCODE,
        })
      ).toBe(TEST_MODEL_OPENCODE);
    });

    it('skips machine config model when hidden', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: ['openai/gpt-4', 'openai/gpt-3.5'], // opencode hidden
          machineConfigModel: TEST_MODEL_OPENCODE,
        })
      ).toBe('openai/gpt-4'); // falls through to step 5
    });
  });

  describe('priority 3: team config model', () => {
    it('selects team config model when visible and no higher priority match', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: allModels,
          teamConfigModel: TEST_MODEL_OPENCODE_ALT,
        })
      ).toBe(TEST_MODEL_OPENCODE_ALT);
    });

    it('skips team config model when hidden', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: ['openai/gpt-4'],
          teamConfigModel: TEST_MODEL_OPENCODE_ALT,
        })
      ).toBe('openai/gpt-4'); // falls through to step 5
    });
  });

  describe('priority 4: saved preference', () => {
    it('selects preference model when visible', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: allModels,
          preferenceModel: 'openai/gpt-3.5',
        })
      ).toBe('openai/gpt-3.5');
    });

    it('skips preference model when hidden', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: [TEST_MODEL_OPENCODE],
          preferenceModel: 'openai/gpt-3.5',
        })
      ).toBe(TEST_MODEL_OPENCODE);
    });
  });

  describe('priority 5: fallback', () => {
    it('selects first visible model when no other match', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: [TEST_MODEL_OPENCODE, TEST_MODEL_OPENCODE_ALT],
        })
      ).toBe(TEST_MODEL_OPENCODE);
    });

    it('falls back to first available if ALL models are hidden', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: [], // all hidden
        })
      ).toBe('openai/gpt-4'); // first available
    });
  });

  describe('priority ordering', () => {
    it('user choice beats machine config', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: allModels,
          userChoice: 'openai/gpt-4',
          machineConfigModel: TEST_MODEL_OPENCODE,
        })
      ).toBe('openai/gpt-4');
    });

    it('machine config beats team config', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: allModels,
          machineConfigModel: 'openai/gpt-4',
          teamConfigModel: TEST_MODEL_OPENCODE,
        })
      ).toBe('openai/gpt-4');
    });

    it('team config beats preference', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: allModels,
          teamConfigModel: 'openai/gpt-4',
          preferenceModel: TEST_MODEL_OPENCODE,
        })
      ).toBe('openai/gpt-4');
    });

    it('hidden machine config falls through to visible team config', () => {
      expect(
        selectModel({
          selectedHarness: 'pi',
          availableModels: allModels,
          visibleModels: ['openai/gpt-4', 'openai/gpt-3.5'], // opencode hidden
          machineConfigModel: TEST_MODEL_OPENCODE, // hidden → skip
          teamConfigModel: 'openai/gpt-4', // visible → selected
        })
      ).toBe('openai/gpt-4');
    });
  });
});
