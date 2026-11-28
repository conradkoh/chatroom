'use client';

import { ArrowUp, ChevronRight, Home, Loader2, RefreshCw } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';

import { breadcrumbSegments, type BreadcrumbSegment } from './remoteFolderBrowserCopy';

import type { RemoteFolderBrowserState } from '@/hooks/useRemoteFolderBrowser';

const NAV_BUTTON =
  'inline-flex h-10 w-10 shrink-0 items-center justify-center border border-chatroom-border text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50 sm:h-8 sm:w-8';

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={NAV_BUTTON}
    >
      {children}
    </button>
  );
}

/** One crumb. The last is the current folder; the collapsed marker is not interactive. */
function Crumb({
  crumb,
  isLast,
  path,
  onNavigate,
}: {
  crumb: BreadcrumbSegment;
  isLast: boolean;
  path: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <li className="flex items-center gap-1">
      {crumb.path === '' ? (
        <span aria-hidden title={path} className="text-chatroom-text-muted">
          {crumb.label}
        </span>
      ) : isLast ? (
        <span
          aria-current="location"
          title={crumb.path}
          className="max-w-40 truncate font-bold text-chatroom-text-primary"
        >
          {crumb.label}
        </span>
      ) : (
        <button
          type="button"
          title={crumb.path}
          onClick={() => onNavigate(crumb.path)}
          className="max-w-36 truncate text-chatroom-text-secondary hover:text-chatroom-text-primary"
        >
          {crumb.label}
        </button>
      )}
      {!isLast && (
        <ChevronRight size={12} aria-hidden className="shrink-0 text-chatroom-text-muted" />
      )}
    </li>
  );
}

/** The folder path as clickable crumbs. The deepest crumb stays in view as the folder changes. */
function Breadcrumbs({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = navRef.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [path]);

  const crumbs = breadcrumbSegments(path);
  return (
    <nav
      ref={navRef}
      aria-label="Folder path"
      className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs"
    >
      <ol className="flex items-center gap-1">
        {crumbs.map((crumb, index) => (
          <Crumb
            key={`${crumb.path}-${crumb.label}`}
            crumb={crumb}
            isLast={index === crumbs.length - 1}
            path={path}
            onNavigate={onNavigate}
          />
        ))}
      </ol>
    </nav>
  );
}

/** Up, Home, Refresh and the breadcrumb for the current folder. */
// fallow-ignore-next-line complexity
export function RemoteFolderBrowserNav({ browser }: { browser: RemoteFolderBrowserState }) {
  const listing = browser.listing;
  const disabled = browser.phase === 'ended' || listing === null;
  return (
    <div className="flex items-center gap-1 border-b border-chatroom-border px-2 py-1.5">
      <NavButton
        label="Up one folder"
        disabled={disabled || listing?.parentPath === null}
        onClick={browser.goUp}
      >
        <ArrowUp size={14} aria-hidden />
      </NavButton>
      <NavButton label="Home folder" disabled={disabled} onClick={browser.goHome}>
        <Home size={14} aria-hidden />
      </NavButton>
      <NavButton label="Refresh folder" disabled={disabled} onClick={browser.retry}>
        {browser.isNavigating ? (
          <Loader2 size={14} aria-hidden className="animate-spin" />
        ) : (
          <RefreshCw size={14} aria-hidden />
        )}
      </NavButton>
      {listing && <Breadcrumbs path={listing.path} onNavigate={browser.navigate} />}
    </div>
  );
}
