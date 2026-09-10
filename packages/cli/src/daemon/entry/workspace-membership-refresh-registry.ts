let refreshRoomMembership: (() => Promise<void>) | null = null;

export function registerWorkspaceMembershipRefresh(refresh: () => Promise<void>): void {
  refreshRoomMembership = refresh;
}

export function unregisterWorkspaceMembershipRefresh(): void {
  refreshRoomMembership = null;
}

export async function refreshWorkspaceMembership(): Promise<void> {
  await refreshRoomMembership?.();
}
