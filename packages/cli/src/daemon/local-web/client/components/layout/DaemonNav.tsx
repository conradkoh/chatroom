import type { ReactNode } from 'react';

export function DaemonNav({ children }: { children: ReactNode }) {
  return <nav className="flex gap-1 border-b border-chatroom-border px-6 py-2">{children}</nav>;
}
export function NavTab({
  active = false,
  children,
  onClick,
}: {
  active?: boolean | undefined;
  children: ReactNode;
  onClick?:( () => void) | undefined;
}) {
  return (
    <span
      className={
        active
          ? 'bg-chatroom-bg-secondary px-3 py-1.5 text-xs font-medium uppercase tracking-wide'
          : 'px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-chatroom-text-muted'
      }
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {children}
    </span>
  );
}
