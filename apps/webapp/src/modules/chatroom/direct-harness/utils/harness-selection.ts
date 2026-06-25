import { harnessSupportsNativeIntegration } from '../../types/machine';
import type { AgentHarness } from '../../types/machine';
import type { HarnessOption } from '../hooks/useHarnessConfig';

const DEFAULT_HARNESS_PREFERENCE = ['pi-sdk', 'cursor-sdk', 'opencode-sdk'] as const;

/** Keep only harnesses that support native direct integration (SDK harnesses). */
export function filterNativeHarnesses(harnesses: HarnessOption[]): HarnessOption[] {
  return harnesses.filter((h) => harnessSupportsNativeIntegration(h.name as AgentHarness));
}

/** Pick the preferred default harness from available native options. */
// fallow-ignore-next-line complexity
export function selectDefaultHarnessName(harnesses: HarnessOption[]): string {
  for (const preferred of DEFAULT_HARNESS_PREFERENCE) {
    if (harnesses.some((h) => h.name === preferred)) {
      return preferred;
    }
  }
  return harnesses[0]?.name ?? 'pi-sdk';
}
