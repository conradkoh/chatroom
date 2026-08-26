export type EnhancerSpawnHandle = {
  jobId: string;
  chatroomId: string;
  abort: () => void;
  stopProcess: () => Promise<void>;
};

const byChatroom = new Map<string, Set<EnhancerSpawnHandle>>();

export function registerEnhancerSpawn(handle: EnhancerSpawnHandle): void {
  const handles = byChatroom.get(handle.chatroomId) ?? new Set<EnhancerSpawnHandle>();
  handles.add(handle);
  byChatroom.set(handle.chatroomId, handles);
}

export function unregisterEnhancerSpawn(handle: EnhancerSpawnHandle): void {
  const handles = byChatroom.get(handle.chatroomId);
  if (!handles) return;
  handles.delete(handle);
  if (handles.size === 0) byChatroom.delete(handle.chatroomId);
}

export async function abortEnhancerSpawnsForChatroom(chatroomId: string): Promise<void> {
  const handles = byChatroom.get(chatroomId);
  if (!handles) return;
  await Promise.all(
    [...handles].map(async (handle) => {
      handle.abort();
      await handle.stopProcess().catch(() => undefined);
    })
  );
}

export function resetEnhancerSpawnRegistryForTests(): void {
  byChatroom.clear();
}
