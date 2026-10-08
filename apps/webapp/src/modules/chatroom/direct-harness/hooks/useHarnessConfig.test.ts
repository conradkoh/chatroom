import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useHarnessConfig } from './useHarnessConfig';
import type { HarnessOption } from './useHarnessConfig';

describe('useHarnessConfig model option labels', () => {
  it('formats raw Claude names without changing selected keys or friendly names', () => {
    const harnesses: HarnessOption[] = [
      {
        name: 'claude-sdk',
        displayName: 'Claude (SDK)',
        agents: [{ name: 'builder', mode: 'primary' }],
        providers: [
          {
            providerID: 'anthropic',
            name: 'Anthropic',
            models: [
              { modelID: 'claude-opus-5-5', name: 'anthropic/claude-opus-5-5' },
              {
                modelID: 'claude-haiku-5-5[effort=xhigh]',
                name: 'anthropic/claude-haiku-5-5[effort=xhigh]',
              },
            ],
          },
          {
            providerID: 'openai',
            name: 'OpenAI',
            models: [{ modelID: 'gpt-4o', name: 'GPT-4o' }],
          },
        ],
      },
    ];
    const { result } = renderHook(() => useHarnessConfig({ harnesses, harnessName: 'claude-sdk' }));

    expect(result.current.modelOptions).toEqual([
      { value: 'anthropic::claude-opus-5-5', label: 'Anthropic · Claude Opus 5.5' },
      {
        value: 'anthropic::claude-haiku-5-5[effort=xhigh]',
        label: 'Anthropic · Claude Haiku 5.5 [effort=xhigh]',
      },
      { value: 'openai::gpt-4o', label: 'OpenAI · GPT-4o' },
    ]);

    act(() => {
      result.current.setSelectedModel('anthropic::claude-haiku-5-5[effort=xhigh]');
    });

    expect(result.current.resolvedModel).toBe('anthropic::claude-haiku-5-5[effort=xhigh]');
  });
});
