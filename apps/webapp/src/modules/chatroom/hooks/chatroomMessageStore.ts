/**
 * chatroomMessageStore — shared timeline message constants.
 *
 * Pure module with zero React or Convex imports.
 *
 * Kept while `TimelineEventCountMenu.tsx` (its only consumer) is not yet wired
 * into an app entry point; `MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE` is reserved for
 * the store's load-older path.
 */
// fallow-ignore-file unused-file unused-export

export const MESSAGE_STORE_LIMIT = 5;
export const MESSAGE_STORE_LOAD_OLDER_PAGE_SIZE = 5;
