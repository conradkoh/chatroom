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
  countLabel,
  icon,
  iconClassName,
  action,
  emptyMessage,
  viewMoreCount = 0,
  viewMoreLabel,
  onViewMore,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  count?: number;
  /** Overrides the numeric count in the header (e.g. "20+" for a capped list). */
  countLabel?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  action?: ReactNode;
  emptyMessage?: string;
  viewMoreCount?: number;
  /** Replaces the footer's counted label (e.g. "View more" for a capped list). */
  viewMoreLabel?: string;
  onViewMore?: () => void;
}) {
  return (
    <section className={cn('border-b border-chatroom-border', className)}>
      <SectionHeader
        title={title}
        count={count}
        countLabel={countLabel}
        icon={icon}
        iconClassName={iconClassName}
        action={action}
      />
      <SectionBody title={title} count={count} emptyMessage={emptyMessage}>
        {children}
      </SectionBody>
      <SectionViewMore
        title={title}
        viewMoreCount={viewMoreCount}
        viewMoreLabel={viewMoreLabel}
        onViewMore={onViewMore}
      />
    </section>
  );
}

function SectionHeader({
  title,
  count,
  countLabel,
  icon,
  iconClassName,
  action,
}: {
  title?: string;
  count?: number;
  countLabel?: string;
  icon?: LucideIcon;
  iconClassName?: string;
  action?: ReactNode;
}) {
  if (!title || !icon) return null;
  return (
    <Header
      title={title}
      count={count ?? 0}
      countLabel={countLabel}
      icon={icon}
      iconClassName={iconClassName}
      action={action}
    />
  );
}

function SectionBody({
  title,
  count,
  emptyMessage,
  children,
}: {
  title?: string;
  count?: number;
  emptyMessage?: string;
  children: ReactNode;
}) {
  if (title && count === 0 && emptyMessage) return <Empty>{emptyMessage}</Empty>;
  return <>{children}</>;
}

function SectionViewMore({
  title,
  viewMoreCount,
  viewMoreLabel,
  onViewMore,
}: {
  title?: string;
  viewMoreCount: number;
  viewMoreLabel?: string;
  onViewMore?: () => void;
}) {
  if (!title || !onViewMore) return null;
  if (viewMoreCount <= 0) return null;
  return <ViewMore count={viewMoreCount} label={viewMoreLabel} onClick={onViewMore} />;
}

export interface SidebarSectionHeaderProps {
  title: string;
  count: number;
  countLabel?: string;
  icon: LucideIcon;
  iconClassName?: string;
  action?: ReactNode;
}

function Header({
  title,
  count,
  countLabel,
  icon: Icon,
  iconClassName,
  action,
}: SidebarSectionHeaderProps) {
  return (
    <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted bg-chatroom-bg-tertiary flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon size={12} className={iconClassName} />
        <span>
          {title} ({countLabel ?? count})
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
function ViewMore({
  count,
  label,
  onClick,
}: {
  count: number;
  label?: string;
  onClick: () => void;
}) {
  return count > 0 ? <ViewMoreButton count={count} label={label} onClick={onClick} /> : null;
}

export const SidebarSection = { Root, Header, Toolbar, Body, Empty, Loading, Subheader, ViewMore };
