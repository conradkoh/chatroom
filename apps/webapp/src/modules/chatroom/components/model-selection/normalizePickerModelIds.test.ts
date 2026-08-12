import { describe, expect, it } from 'vitest';
import { normalizePickerModelIds } from './normalizePickerModelIds';

describe('normalizePickerModelIds', () => {
  it('drops redundant none variants', () => {
    expect(normalizePickerModelIds(['claude-opus-4-8', 'claude-opus-4-8[effort=none]'])).toEqual(['claude-opus-4-8']);
    expect(normalizePickerModelIds(['gpt-5.6-terra', 'gpt-5.6-terra[reasoning=none]'])).toEqual(['gpt-5.6-terra']);
  });
  it('drops stale aliases only when canonical models are present', () => {
    expect(normalizePickerModelIds(['opus', 'opus[effort=none]', 'claude-opus-4-8'])).toEqual(['claude-opus-4-8']);
    expect(normalizePickerModelIds(['opus', 'opus[effort=high]'])).toEqual(['opus', 'opus[effort=high]']);
  });
});
