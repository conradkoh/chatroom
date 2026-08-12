import type { ReactNode } from 'react';

export function DaemonNav({ children }: { children: ReactNode }) {
  return <nav className="flex gap-1 border-b border-chatroom-border px-6 py-2">{children}</nav>;
}
export function NavTab({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span
      className={
        active
          ? 'bg-chatroom-bg-secondary px-3 py-1.5 text-xs font-medium uppercase tracking-wide'
          : 'px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-chatroom-text-muted'
      }
    >
      {children}
    </span>
  );
}
