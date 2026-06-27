import { ChatroomLoader } from '@/components/ui/chatroom-loader';

/** Lightweight placeholder while lazily loaded workspace panels compile. */
export function PanelLoadingSpinner() {
  return (
    <div className="chatroom-root flex flex-1 items-center justify-center bg-chatroom-bg-primary">
      <ChatroomLoader size="md" />
    </div>
  );
}
