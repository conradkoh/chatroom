'use client';

const SKELETON_ROW_COUNT = 8;

function ChatroomSidebarSkeletonRow() {
  return (
    <div
      className="w-full px-3 py-2 flex items-center gap-2 border-b border-chatroom-border border-l-2 border-l-transparent"
      aria-hidden="true"
    >
      <div className="w-1.5 h-1.5 flex-shrink-0 bg-chatroom-bg-tertiary animate-pulse" />
      <div className="h-3 flex-1 max-w-[75%] rounded-sm bg-chatroom-bg-tertiary animate-pulse" />
    </div>
  );
}

export function ChatroomSidebarSkeleton() {
  return (
    <div
      className="chatroom-root flex flex-col w-full h-full overflow-hidden bg-chatroom-bg-surface"
      role="status"
      aria-label="Loading chatrooms"
      aria-busy="true"
    >
      {/* Real header — matches loaded sidebar, minimizes layout shift */}
      <div className="flex items-center justify-between h-14 px-4 border-b-2 border-chatroom-border shrink-0">
        <div className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          Chatrooms
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Section header skeleton (Active) */}
        <div
          className="px-3 py-2 flex items-center gap-1.5 bg-chatroom-bg-tertiary"
          aria-hidden="true"
        >
          <div className="w-1.5 h-1.5 flex-shrink-0 bg-chatroom-bg-hover animate-pulse" />
          <div className="h-2.5 w-12 rounded-sm bg-chatroom-bg-hover animate-pulse" />
        </div>

        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, i) => (
          <ChatroomSidebarSkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
