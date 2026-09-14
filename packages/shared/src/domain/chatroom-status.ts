/** Persisted lifecycle statuses for a chatroom. */
export const CHATROOM_STATUSES = ['active', 'completed'] as const;

export type ChatroomStatus = (typeof CHATROOM_STATUSES)[number];

/** Runtime-safe enum used by domain and persistence code. */
export const ChatroomStatusEnum = {
  active: 'active',
  completed: 'completed',
} as const satisfies { readonly [K in ChatroomStatus]: K };
