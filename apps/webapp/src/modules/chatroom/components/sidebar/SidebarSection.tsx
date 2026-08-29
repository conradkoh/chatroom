import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { ViewMoreButton } from './ViewMoreButton';

import { cn } from '@/lib/utils';

/** Max items shown per sidebar list section before "View More". */
export const SIDEBAR_PREVIEW_LIMIT = 3;

function Root({
  children,
  className,
  title,
  count,
  icon,
  iconClassName,
  action,
  emptyMessage,
  viewMoreCount,
  onViewMore,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  count?: number;
  icon?: LucideIcon;
  iconClassName?: string;
  action?: ReactNode;
  emptyMessage?: string;
  viewMoreCount?: number;
  onViewMore?: () => void;
}) {
  return (
    <section className={cn('border-b border-chatroom-border', className)}>
      {title && icon ? (
        <Header
          title={title}
          count={count ?? 0}
          icon={icon}
          iconClassName={iconClassName}
          action={action}
        />
      ) : null}
      {title && count === 0 && emptyMessage ? <Empty>{emptyMessage}</Empty> : children}
      {title && (viewMoreCount ?? 0) > 0 && onViewMore ? (
        <ViewMore count={viewMoreCount ?? 0} onClick={onViewMore} />
      ) : null}
    </section>
  );
}

export interface SidebarSectionHeaderProps {
  title: string;
  count: number;
  icon: LucideIcon;
  iconClassName?: string;
  action?: ReactNode;
}

function Header({ title, count, icon: Icon, iconClassName, action }: SidebarSectionHeaderProps) {
  return (
    <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon size={12} className={iconClassName} />
        <span>
          {title} ({count})
        </span>
      </div>
      {action ?? null}
    </div>
  );
}

function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'px-3 py-2 border-b border-chatroom-border/50 flex items-center gap-4',
        className
      )}
    >
      {children}
    </div>
  );
}
function Body({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}
function Empty({ children }: { children: ReactNode }) {
  return <div className="p-3 text-center text-chatroom-text-muted text-xs">{children}</div>;
}
function Loading({ children }: { children: ReactNode }) {
  return <div className="p-4 flex items-center justify-center">{children}</div>;
}
function Subheader({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted border-t border-chatroom-border">
      {children}
    </div>
  );
}
function ViewMore({ count, onClick }: { count: number; onClick: () => void }) {
  return count > 0 ? <ViewMoreButton count={count} onClick={onClick} /> : null;
}

export const SidebarSection = { Root, Header, Toolbar, Body, Empty, Loading, Subheader, ViewMore };
