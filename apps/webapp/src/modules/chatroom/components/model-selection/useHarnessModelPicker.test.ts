import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useHarnessModelPicker } from './useHarnessModelPicker';

vi.mock('./useMachineModelFilter', () => ({
  useMachineModelFilter: () => ({
    filter: { hiddenModels: ['anthropic/claude-sonnet-4'], hiddenProviders: [] },
    setFilter: vi.fn(),
    isHidden: (model: string) => model === 'anthropic/claude-sonnet-4',
    enabled: true,
  }),
}));

const AVAILABLE = ['openai/gpt-4o', 'anthropic/claude-sonnet-4', 'anthropic/claude-opus-4'];

describe('useHarnessModelPicker', () => {
  it('filters hidden models from visible list and groups', () => {
    const { result } = renderHook(() =>
      useHarnessModelPicker({
        machineId: 'machine-a',
        harness: 'cursor',
        availableModels: AVAILABLE,
        selectedModel: 'anthropic/claude-sonnet-4',
      })
    );

    expect(result.current.visibleModels).toEqual(['openai/gpt-4o', 'anthropic/claude-opus-4']);
    expect(result.current.modelGroups).toHaveLength(2);
    expect(result.current.isSelectedModelHidden).toBe(true);
  });

  it('reports selected model as not hidden when visible', () => {
    const { result } = renderHook(() =>
      useHarnessModelPicker({
        machineId: 'machine-a',
        harness: 'cursor',
        availableModels: AVAILABLE,
        selectedModel: 'openai/gpt-4o',
      })
    );

    expect(result.current.isSelectedModelHidden).toBe(false);
  });
});
