import { getHarnessDisplayName, harnessSupportsNativeIntegration } from '../../types/machine';
import type { AgentHarness } from '../../types/machine';
import type { HarnessOption } from '../hooks/useHarnessConfig';

const NATIVE_SDK_HARNESS_NAMES = ['pi-sdk', 'cursor-sdk', 'opencode-sdk'] as const;
const DEFAULT_HARNESS_PREFERENCE = NATIVE_SDK_HARNESS_NAMES;

/** Keep only harnesses that support native direct integration (SDK harnesses). */
function filterNativeHarnesses(harnesses: HarnessOption[]): HarnessOption[] {
  return harnesses.filter((h) => harnessSupportsNativeIntegration(h.name as AgentHarness));
}

/** Static catalog of all native SDK harnesses for the selector when daemon capabilities are absent or partial. */
function getNativeHarnessCatalog(): HarnessOption[] {
  return NATIVE_SDK_HARNESS_NAMES.map((name) => ({
    name,
    displayName: getHarnessDisplayName(name),
    agents: [],
    providers: [],
  }));
}

/**
 * Merge daemon-reported harness capabilities with the full native SDK catalog.
 * Daemon data (agents, providers) wins when present; catalog fills gaps for testing/selection.
 */
export function resolveNativeHarnessOptions(reported: HarnessOption[]): HarnessOption[] {
  const byName = new Map(getNativeHarnessCatalog().map((h) => [h.name, h]));
  for (const harness of filterNativeHarnesses(reported)) {
    byName.set(harness.name, harness);
  }
  return NATIVE_SDK_HARNESS_NAMES.flatMap((name) => {
    const harness = byName.get(name);
    return harness ? [harness] : [];
  });
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
