'use client';

import { FileStoragePanel } from '@/modules/chatroom/features/file-attachments/components/FileStoragePanel';

/**
 * Profile section for the account-wide file quota. Per-chatroom limits live in
 * the chatroom's Files settings (S7b).
 */
export function FileStorageSettings() {
  return (
    <div className="mt-6 border-t pt-6">
      <h2 className="text-xl font-semibold mb-2">File Storage</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Files agents attach to handoffs addressed to you. This limit applies across all your
        chatrooms.
      </p>
      <FileStoragePanel scope={{ kind: 'user' }} />
    </div>
  );
}
