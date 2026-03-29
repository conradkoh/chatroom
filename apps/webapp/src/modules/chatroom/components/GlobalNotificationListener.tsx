'use client';

import { useChatroomListing } from '@/modules/chatroom/context/ChatroomListingContext';
import { useGlobalHandoffNotification } from '@/modules/chatroom/hooks/useGlobalHandoffNotification';

/**
 * Invisible component that mounts the global notification hook.
 *
 * Must be rendered inside ChatroomListingProvider so it can access
 * the chatroom listing context. Fires browser notifications when
 * any chatroom transitions to "unread" — regardless of tab focus state.
 *
 * Renders nothing — side-effects only.
 */
export function GlobalNotificationListener() {
  const { chatrooms } = useChatroomListing();
  useGlobalHandoffNotification(chatrooms);
  return null;
}
