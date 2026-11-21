'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

const TAB_CLASSES =
  'inline-flex min-h-10 items-center border-b-2 pb-1 text-xs font-bold uppercase tracking-widest transition-colors sm:min-h-0';

function tabClasses(active: boolean): string {
  return cn(
    TAB_CLASSES,
    active
      ? 'border-chatroom-accent text-chatroom-accent'
      : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
  );
}

/**
 * The `Chatrooms | Machines` section strip shared by the chatroom list and the
 * Machines page.
 *
 * These are real route links, not local tabs: `/app` and `/app/machines` are
 * separate pages. The strip is absent from the new-chatroom wizard, the
 * chatroom itself and the list's loading state (see the call sites).
 */
export function AppSectionTabs() {
  const pathname = usePathname();
  const isChatrooms = pathname === '/app';
  const isMachines = pathname.startsWith('/app/machines');

  return (
    <nav aria-label="Sections" data-testid="app-section-tabs" className="mb-4 flex gap-6">
      <Link
        href="/app"
        aria-current={isChatrooms ? 'page' : undefined}
        data-testid="app-section-tab-chatrooms"
        className={tabClasses(isChatrooms)}
      >
        Chatrooms
      </Link>
      <Link
        href="/app/machines"
        aria-current={isMachines ? 'page' : undefined}
        data-testid="app-section-tab-machines"
        className={tabClasses(isMachines)}
      >
        Machines
      </Link>
    </nav>
  );
}
