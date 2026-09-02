import type { ReactNode } from 'react';

type Props = { header: ReactNode; nav?: ReactNode | undefined; children: ReactNode };
export function DaemonAppShell({ header, nav, children }: Props) {
  return (
    <div className="chatroom-root flex h-full min-h-screen flex-col bg-chatroom-bg-primary text-chatroom-text-primary">
      {header}
      {nav}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
