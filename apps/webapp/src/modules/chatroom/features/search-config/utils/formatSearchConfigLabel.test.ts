import { describe, expect, test } from 'vitest';
import { formatSearchConfigLabel } from './formatSearchConfigLabel';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';

const mockHarnesses: HarnessOption[] = [
  {
    name: 'opencode-sdk',
    providers: [
      { providerID: 'openai', name: 'OpenAI', models: [{ modelID: 'gpt-4o', name: 'GPT-4o' }] },
    ],
  } as HarnessOption,
];

describe('formatSearchConfigLabel', () => {
  test('formats label with known harness and model', () => {
    const result = formatSearchConfigLabel(
      { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' },
      mockHarnesses
    );
    expect(result).toContain('SDK');
    expect(result).toContain('GPT-4o');
  });

  test('falls back to modelKey when harness not found', () => {
    const result = formatSearchConfigLabel(
      { harnessName: 'unknown', modelKey: 'foo::bar' },
      mockHarnesses
    );
    expect(result).toContain('Unknown /');
    expect(result).toContain('foo::bar');
  });
});
