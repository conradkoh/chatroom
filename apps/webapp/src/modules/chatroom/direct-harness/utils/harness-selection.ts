import {
  formatHarnessLabel,
  getHarnessDisplayName,
  harnessSupportsNativeIntegration,
} from '../../types/machine';
import type { AgentHarness, HarnessVersionInfo } from '../../types/machine';
import type { HarnessOption } from '../hooks/useHarnessConfig';

const NATIVE_SDK_HARNESS_NAMES = ['pi-sdk', 'cursor-sdk', 'opencode-sdk', 'claude-sdk'] as const;
const DEFAULT_HARNESS_PREFERENCE = NATIVE_SDK_HARNESS_NAMES;

/** Merge machine.harnessVersions into harness options for consistent labeling. */
export function applyHarnessVersions(
  harnesses: HarnessOption[],
  versions?: Partial<Record<AgentHarness, HarnessVersionInfo>>
): HarnessOption[] {
  if (!versions) return harnesses;
  return harnesses.map((h) => {
    const version = versions[h.name as AgentHarness];
    if (!version) return h;
    return {
      ...h,
      version,
      displayName: formatHarnessLabel(h.name, version),
    };
  });
}

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
    const catalog = byName.get(harness.name);
    byName.set(harness.name, {
      ...catalog,
      ...harness,
      displayName: catalog?.displayName ?? harness.displayName,
    });
  }
  return NATIVE_SDK_HARNESS_NAMES.flatMap((name) => {
    const harness = byName.get(name);
    return harness ? [harness] : [];
  });
}

/** Pick the preferred default harness from available native options. */
// fallow-ignore-next-line complexity
function selectDefaultHarnessName(harnesses: HarnessOption[]): string {
  for (const preferred of DEFAULT_HARNESS_PREFERENCE) {
    if (harnesses.some((h) => h.name === preferred)) {
      return preferred;
    }
  }
  return harnesses[0]?.name ?? 'pi-sdk';
}

/** Resolve a user-selected harness name against available native options. */
export function resolveSelectedHarnessName(
  harnesses: HarnessOption[],
  harnessName: string
): string {
  if (harnesses.length === 0) return harnessName;
  if (harnesses.some((h) => h.name === harnessName)) return harnessName;
  return selectDefaultHarnessName(harnesses);
}
