/**
 * Puts the currently open chatroom first while preserving relative order of the rest.
 * Used by Cmd+K switcher so the active room is the default top item.
 */
export function sortChatroomsWithCurrentFirst<T extends { _id: string }>(
  chatrooms: T[],
  currentChatroomId: string | null
): T[] {
  if (!currentChatroomId) return chatrooms;

  const currentIndex = chatrooms.findIndex((chatroom) => chatroom._id === currentChatroomId);
  if (currentIndex <= 0) return chatrooms;

  const reordered = [...chatrooms];
  const [current] = reordered.splice(currentIndex, 1);
  return [current, ...reordered];
}
