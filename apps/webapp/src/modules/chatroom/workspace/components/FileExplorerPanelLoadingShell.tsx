import { ChatroomLoader } from '@/components/ui/chatroom-loader';

/** Shell shown while the explorer panel chunk loads — keeps header visible. */
export function FileExplorerPanelLoadingShell() {
  return (
    <div className="h-full flex flex-col min-w-0">
      <div className="px-3 py-2 border-b-2 border-chatroom-border-strong flex items-center justify-between shrink-0">
        <span className="text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
          Explorer
        </span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-chatroom-text-muted text-xs">
        <ChatroomLoader size="sm" />
        Loading…
      </div>
    </div>
  );
}
