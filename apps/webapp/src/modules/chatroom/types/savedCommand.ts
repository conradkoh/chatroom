import type { Id } from '@workspace/backend/convex/_generated/dataModel';

/** Discriminator literals — extend with future variants here. */
export type SavedCommandType = 'prompt';

/** Scope for saved commands. */
export type SavedCommandScope = 'user' | 'chatroom';

/** Variant: free-form prompt sent as a chat message. */
export interface SavedPromptCommand {
  _id: Id<'chatroom_savedCommands'>;
  type: 'prompt';
  scope: SavedCommandScope;
  name: string;
  prompt: string;
}

/** Discriminated union of all saved-command variants. */
export type SavedCommand = SavedPromptCommand;

/** Input shape for `createSavedCommand` (no `_id`, server fills metadata). */
export type SavedCommandCreateInput = {
  type: 'prompt';
  scope: SavedCommandScope;
  name: string;
  prompt: string;
};

/** Input shape for `updateSavedCommand`'s `command` arg. */
export type SavedCommandUpdateInput = { type: 'prompt'; prompt: string };

export const SAVED_COMMAND_TYPES = ['prompt'] as const satisfies readonly SavedCommandType[];

export const SAVED_COMMAND_TYPE_LABELS: Record<SavedCommandType, string> = {
  prompt: 'Message Prompt',
};

export const SAVED_COMMAND_SCOPES = [
  'user',
  'chatroom',
] as const satisfies readonly SavedCommandScope[];

export const SAVED_COMMAND_SCOPE_LABELS: Record<SavedCommandScope, string> = {
  user: 'User (all chatrooms)',
  chatroom: 'Chatroom only',
};
