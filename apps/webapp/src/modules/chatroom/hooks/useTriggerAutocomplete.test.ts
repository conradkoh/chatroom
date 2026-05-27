import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTriggerAutocomplete, type TriggerDefinition } from './useTriggerAutocomplete';

function createTrigger(onActivate: () => void): TriggerDefinition<string> {
  return {
    triggerChar: '@',
    isValidPosition: () => true,
    isEnabled: () => true,
    getResults: (query) => (query ? [query] : ['alpha']),
    serialize: (item) => item,
    onActivate,
  };
}

describe('useTriggerAutocomplete', () => {
  it('fires onActivate once per visible activation and again after hiding', () => {
    const onActivate = vi.fn();
    const trigger = createTrigger(onActivate);

    const { result } = renderHook(() => useTriggerAutocomplete([trigger]));

    act(() => {
      result.current.handleInputChange('@', 1);
    });
    expect(onActivate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleInputChange('@a', 2);
      result.current.handleInputChange('@ab', 3);
    });
    expect(onActivate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleInputChange('no trigger', 10);
    });
    expect(result.current.state.visible).toBe(false);

    act(() => {
      result.current.handleInputChange('@', 1);
    });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('fires onActivate again after explicit dismiss', () => {
    const onActivate = vi.fn();
    const trigger = createTrigger(onActivate);

    const { result } = renderHook(() => useTriggerAutocomplete([trigger]));

    act(() => {
      result.current.handleInputChange('@', 1);
    });
    expect(onActivate).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleDismiss();
      result.current.handleInputChange('@', 1);
    });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
});
