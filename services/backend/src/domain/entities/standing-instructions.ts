export interface StandingInstructionsFields {
  standingInstructions?: string;
  standingInstructionsEnabled?: boolean;
}

export function getActiveStandingInstructions(chatroom: StandingInstructionsFields): string | null {
  if (chatroom.standingInstructionsEnabled !== true) return null;
  const content = chatroom.standingInstructions?.trim();
  return content ? content : null;
}
