import { getHarnessModelLabel } from '@/modules/chatroom/components/model-selection';
import { getHarnessDisplayName } from '@/modules/chatroom/types/machine';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import type { SearchConfigEntry } from '../types/searchConfig';

export function formatSearchConfigLabel(
  entry: SearchConfigEntry,
  harnesses: HarnessOption[]
): string {
  const harnessLabel = getHarnessDisplayName(entry.harnessName);
  const harnessOpt = harnesses.find((h) => h.name === entry.harnessName);
  const modelLabel = harnessOpt ? getHarnessModelLabel(harnessOpt.providers, entry.modelKey) : null;
  return `${harnessLabel} / ${modelLabel ?? entry.modelKey}`;
}
