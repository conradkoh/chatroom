export interface StandingInstructionsFields {
  standingInstructions?: string;
  standingInstructionsEnabled?: boolean;
}

export function getActiveStandingInstructions(chatroom: StandingInstructionsFields): string | null {
  if (chatroom.standingInstructionsEnabled !== true) return null;
  const content = chatroom.standingInstructions?.trim();
  return content ? content : null;
}

export function normalizeStandingInstructionContent(content: string): string {
  return content.trim();
}

export function standingInstructionContentKey(content: string): string {
  return normalizeStandingInstructionContent(content);
}

export type StandingInstructionHistoryFields = {
  useCount: number;
  lastUsedAt: number;
};

/** Higher useCount first; ties broken by more recent lastUsedAt. */
export function compareStandingInstructionHistoryByRank(
  a: StandingInstructionHistoryFields,
  b: StandingInstructionHistoryFields
): number {
  if (b.useCount !== a.useCount) return b.useCount - a.useCount;
  return b.lastUsedAt - a.lastUsedAt;
}

const DISPLAY_TITLE_MAX = 60;

/**
 * Primary display label for a standing instruction. Uses the title when set;
 * falls back to a truncated first line of content for legacy records.
 */
export function standingInstructionDisplayTitle(item: { title?: string; content: string }): string {
  const trimmedTitle = item.title?.trim();
  if (trimmedTitle) return trimmedTitle;
  const firstLine = item.content.split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= DISPLAY_TITLE_MAX) return firstLine;
  return `${firstLine.slice(0, DISPLAY_TITLE_MAX - 3)}...`;
}
