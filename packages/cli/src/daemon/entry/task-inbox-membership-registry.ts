let refreshRoomMembership: (() => Promise<void>) | null = null;

export function registerTaskInboxRoomMembershipRefresh(refresh: () => Promise<void>): void {
  refreshRoomMembership = refresh;
}

export function unregisterTaskInboxRoomMembershipRefresh(): void {
  refreshRoomMembership = null;
}

export async function refreshTaskInboxRoomMembership(): Promise<void> {
  await refreshRoomMembership?.();
}
