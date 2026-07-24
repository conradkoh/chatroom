import type { SearchConfigEntry } from '../types/searchConfig';

import { getHarnessModelLabel } from '@/modules/chatroom/components/model-selection';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import { formatHarnessLabel } from '@/modules/chatroom/types/machine';

function findHarnessOption(
  entry: SearchConfigEntry,
  harnesses: HarnessOption[]
): HarnessOption | undefined {
  return harnesses.find((h) => h.name === entry.harnessName);
}

export function getSearchConfigHarnessLabel(
  entry: SearchConfigEntry,
  harnesses: HarnessOption[]
): string {
  const harnessOpt = findHarnessOption(entry, harnesses);
  return formatHarnessLabel(entry.harnessName, harnessOpt?.version);
}

export function getSearchConfigModelLabel(
  entry: SearchConfigEntry,
  harnesses: HarnessOption[]
): string {
  const harnessOpt = findHarnessOption(entry, harnesses);
  return harnessOpt
    ? (getHarnessModelLabel(harnessOpt.providers, entry.modelKey) ?? entry.modelKey)
    : entry.modelKey;
}

export function formatSearchConfigLabel(
  entry: SearchConfigEntry,
  harnesses: HarnessOption[]
): string {
  return `${getSearchConfigHarnessLabel(entry, harnesses)} / ${getSearchConfigModelLabel(entry, harnesses)}`;
}
