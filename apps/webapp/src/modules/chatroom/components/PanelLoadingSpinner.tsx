/** Lightweight placeholder while lazily loaded workspace panels compile. */
export function PanelLoadingSpinner() {
  return (
    <div className="chatroom-root flex flex-1 items-center justify-center bg-chatroom-bg-primary">
      <div className="w-8 h-8 border-2 border-chatroom-border border-t-chatroom-accent animate-spin" />
    </div>
  );
}
