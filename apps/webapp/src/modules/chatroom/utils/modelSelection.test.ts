import { describe, expect, it } from 'vitest';

import { isModelHidden, selectModel } from './modelSelection';

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
    expect(isModelHidden('anthropic/claude-3', filter)).toBe(false);
  });
});

// ─── selectModel ────────────────────────────────────────────────────

describe('selectModel', () => {
  const allModels = ['openai/gpt-4', 'openai/gpt-3.5', 'anthropic/claude-3', 'anthropic/haiku'];

  describe('edge cases', () => {
    it('returns null when no harness selected', () => {
      expect(selectModel({
        selectedHarness: null,
        availableModels: allModels,
        visibleModels: allModels,
      })).toBeNull();
    });

    it('returns null when no models available', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: [],
        visibleModels: [],
      })).toBeNull();
    });
  });

  describe('priority 1: explicit user choice', () => {
    it('selects the explicit user choice even if hidden (not in visibleModels)', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: ['anthropic/claude-3', 'anthropic/haiku'], // openai models hidden
        userChoice: 'openai/gpt-4', // hidden but explicitly chosen
      })).toBe('openai/gpt-4');
    });

    it('ignores user choice if model no longer available', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: ['anthropic/claude-3'],
        visibleModels: ['anthropic/claude-3'],
        userChoice: 'openai/gpt-4', // not in availableModels
      })).toBe('anthropic/claude-3');
    });
  });

  describe('priority 2: machine config model', () => {
    it('selects machine config model when visible', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: allModels,
        machineConfigModel: 'anthropic/claude-3',
      })).toBe('anthropic/claude-3');
    });

    it('skips machine config model when hidden', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: ['openai/gpt-4', 'openai/gpt-3.5'], // anthropic hidden
        machineConfigModel: 'anthropic/claude-3',
      })).toBe('openai/gpt-4'); // falls through to step 5
    });
  });

  describe('priority 3: team config model', () => {
    it('selects team config model when visible and no higher priority match', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: allModels,
        teamConfigModel: 'anthropic/haiku',
      })).toBe('anthropic/haiku');
    });

    it('skips team config model when hidden', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: ['openai/gpt-4'],
        teamConfigModel: 'anthropic/haiku',
      })).toBe('openai/gpt-4'); // falls through to step 5
    });
  });

  describe('priority 4: saved preference', () => {
    it('selects preference model when visible', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: allModels,
        preferenceModel: 'openai/gpt-3.5',
      })).toBe('openai/gpt-3.5');
    });

    it('skips preference model when hidden', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: ['anthropic/claude-3'],
        preferenceModel: 'openai/gpt-3.5',
      })).toBe('anthropic/claude-3');
    });
  });

  describe('priority 5: fallback', () => {
    it('selects first visible model when no other match', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: ['anthropic/claude-3', 'anthropic/haiku'],
      })).toBe('anthropic/claude-3');
    });

    it('falls back to first available if ALL models are hidden', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: [], // all hidden
      })).toBe('openai/gpt-4'); // first available
    });
  });

  describe('priority ordering', () => {
    it('user choice beats machine config', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: allModels,
        userChoice: 'openai/gpt-4',
        machineConfigModel: 'anthropic/claude-3',
      })).toBe('openai/gpt-4');
    });

    it('machine config beats team config', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: allModels,
        machineConfigModel: 'openai/gpt-4',
        teamConfigModel: 'anthropic/claude-3',
      })).toBe('openai/gpt-4');
    });

    it('team config beats preference', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: allModels,
        teamConfigModel: 'openai/gpt-4',
        preferenceModel: 'anthropic/claude-3',
      })).toBe('openai/gpt-4');
    });

    it('hidden machine config falls through to visible team config', () => {
      expect(selectModel({
        selectedHarness: 'pi',
        availableModels: allModels,
        visibleModels: ['openai/gpt-4', 'openai/gpt-3.5'], // anthropic hidden
        machineConfigModel: 'anthropic/claude-3', // hidden → skip
        teamConfigModel: 'openai/gpt-4', // visible → selected
      })).toBe('openai/gpt-4');
    });
  });
});
