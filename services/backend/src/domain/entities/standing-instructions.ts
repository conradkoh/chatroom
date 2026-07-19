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
