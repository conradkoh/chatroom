// fallow-ignore-file unused-export
import { standingInstructionContentKey } from '@workspace/backend/src/domain/entities/standing-instructions';

import type { StandingInstructionHistoryItem } from '../types/standingInstructionHistory';

export const SYNTHETIC_CURRENT_ID = '__current__' as const;

export type SyntheticCurrentItem = {
  id: typeof SYNTHETIC_CURRENT_ID;
  content: string;
  title: string;
};

export type PickerListItem = StandingInstructionHistoryItem | SyntheticCurrentItem;

export function isSyntheticCurrentItem(item: PickerListItem): item is SyntheticCurrentItem {
  return item.id === SYNTHETIC_CURRENT_ID;
}

export function findActiveHistoryMatch(
  history: StandingInstructionHistoryItem[],
  storedContent: string
): StandingInstructionHistoryItem['id'] | null {
  const key = standingInstructionContentKey(storedContent);
  return history.find((h) => standingInstructionContentKey(h.content) === key)?.id ?? null;
}

function buildInactivePickerList(
  history: StandingInstructionHistoryItem[],
  inactiveVisibleCount: number
): { visible: PickerListItem[]; activeId: null; hasMore: boolean } {
  const visible = history.slice(0, inactiveVisibleCount);
  return { visible, activeId: null, hasMore: history.length > visible.length };
}

function buildActivePickerList(
  history: StandingInstructionHistoryItem[],
  trimmedContent: string,
  storedTitle: string,
  activeAlternateCount: number
): { visible: PickerListItem[]; activeId: string; hasMore: boolean } {
  const matchedId = findActiveHistoryMatch(history, trimmedContent);
  const activeId = matchedId ?? SYNTHETIC_CURRENT_ID;

  const matchedItem = matchedId ? history.find((h) => h.id === matchedId) : undefined;
  const activeRow: PickerListItem = matchedItem ?? {
    id: SYNTHETIC_CURRENT_ID,
    content: trimmedContent,
    title: storedTitle,
  };

  const alternates = history.filter((h) => h.id !== matchedId).slice(0, activeAlternateCount);
  const visible: PickerListItem[] = [activeRow, ...alternates];
  const totalWhenActive = 1 + history.filter((h) => h.id !== matchedId).length;

  return { visible, activeId, hasMore: totalWhenActive > visible.length };
}

// fallow-ignore-next-line complexity
export function buildStandingInstructionsPickerList(args: {
  history: StandingInstructionHistoryItem[];
  storedContent: string;
  storedTitle: string;
  isActive: boolean;
  inactiveVisibleCount?: number;
  activeAlternateCount?: number;
}): { visible: PickerListItem[]; activeId: string | null; hasMore: boolean } {
  const inactiveVisibleCount = args.inactiveVisibleCount ?? 8;
  const activeAlternateCount = args.activeAlternateCount ?? 2;
  const trimmedContent = args.storedContent.trim();

  if (!args.isActive || !trimmedContent) {
    return buildInactivePickerList(args.history, inactiveVisibleCount);
  }

  return buildActivePickerList(
    args.history,
    trimmedContent,
    args.storedTitle,
    activeAlternateCount
  );
}
