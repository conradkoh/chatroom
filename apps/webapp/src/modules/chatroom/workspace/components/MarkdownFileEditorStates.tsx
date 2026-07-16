'use client';

import { FileWarning } from 'lucide-react';

import { ChatroomLoader } from '@/components/ui/chatroom-loader';

export function MarkdownFileEditorBinaryState({ filePath }: { filePath: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-chatroom-text-muted p-8">
      <FileWarning size={40} className="text-chatroom-text-muted/50" />
      <div className="text-sm">Binary file — cannot be displayed as text</div>
      <div className="text-xs text-chatroom-text-muted/70">{filePath}</div>
    </div>
  );
}

export function MarkdownFileEditorLoadingState() {
  return (
    <div className="flex-1 flex items-center justify-center gap-2 text-chatroom-text-muted text-sm">
      <ChatroomLoader size="sm" />
      Loading…
    </div>
  );
}
