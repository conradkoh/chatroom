// fallow-ignore-file unused-file unused-export
// Unwired until SetupFolderPickerField renders the browser; the field commit removes this marker.
'use client';

import { AlertCircle, Info, Server, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

import {
  bodyKindOf,
  errorCopy,
  liveRegionText,
  NO_RESPONSE_SECONDS,
  noticeCopy,
  selectDisabledReason,
  type BrowserBodyKind,
} from './remoteFolderBrowserCopy';
import { BODY_BUTTON_CLASS_NAME, RemoteFolderBrowserList } from './RemoteFolderBrowserList';
import { RemoteFolderBrowserNav } from './RemoteFolderBrowserNav';
import { RemoteFolderBrowserNotice } from './RemoteFolderBrowserNotice';
import { RemoteFolderBrowserToolbar } from './RemoteFolderBrowserToolbar';
import { setupPrimaryButtonClassName, setupSecondaryButtonClassName } from './SetupStepLayout';
import { popOverlayDismiss, pushOverlayDismiss } from '../shared/overlayDismissStack';

import { Skeleton } from '@/components/ui/skeleton';
import type { RemoteFolderBrowserState } from '@/hooks/useRemoteFolderBrowser';

export interface RemoteFolderBrowserProps {
  /** DOM id of the panel; the Browse button uses it for aria-controls. */
  id: string;
  browser: RemoteFolderBrowserState;
  /** Caption for the first load; the call-site waitingText. */
  loadingCaption: string;
  /** Fired after select() or cancel(); the field moves focus. */
  onExit: (reason: 'select' | 'cancel') => void;
}

const CENTERED_CLASS_NAME =
  'flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-chatroom-text-secondary';

/** The centred message for the error, no-response and ended bodies. */
function BodyMessage({
  Icon,
  iconClassName,
  message,
  actionLabel,
  onAction,
}: {
  Icon: LucideIcon;
  iconClassName: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className={CENTERED_CLASS_NAME}>
      <Icon size={16} aria-hidden className={iconClassName} />
      <p>{message}</p>
      <button type="button" className={BODY_BUTTON_CLASS_NAME} onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}

/** The one body the panel shows: loading, the list, or a message. Never a list and a message. */
// fallow-ignore-next-line complexity
function BrowserBody({
  browser,
  kind,
  machine,
  loadingCaption,
}: {
  browser: RemoteFolderBrowserState;
  kind: BrowserBodyKind;
  machine: string;
  loadingCaption: string;
}) {
  switch (kind) {
    case 'loading':
      return (
        <div className="flex flex-col gap-2 p-2">
          <p className="px-1 text-xs text-chatroom-text-muted">{loadingCaption}</p>
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-8 w-full" />
          ))}
        </div>
      );
    case 'list':
      return <RemoteFolderBrowserList browser={browser} />;
    case 'error':
      return (
        <BodyMessage
          Icon={AlertCircle}
          iconClassName="text-chatroom-status-error"
          message={
            browser.error
              ? errorCopy(browser.error, machine)
              : 'Could not read this folder. Try again or type a path.'
          }
          actionLabel="Try again"
          onAction={browser.retry}
        />
      );
    case 'no-response':
      return (
        <BodyMessage
          Icon={AlertCircle}
          iconClassName="text-chatroom-status-error"
          message={`${machine} did not answer within ${NO_RESPONSE_SECONDS} seconds. Its daemon may be offline, or its CLI may be too old to browse folders.`}
          actionLabel="Try again"
          onAction={browser.retry}
        />
      );
    case 'ended':
      return (
        <BodyMessage
          Icon={Info}
          iconClassName="text-chatroom-status-info"
          message="This folder browser session ended after 10 minutes of inactivity, or was removed."
          actionLabel="Reopen"
          onAction={browser.retry}
        />
      );
  }
}

/** Status line and the Cancel and Select buttons. Select is linked to the status when disabled. */
// fallow-ignore-next-line complexity
function BrowserFooter({
  browser,
  reason,
  statusId,
  onExit,
}: {
  browser: RemoteFolderBrowserState;
  reason: string | null;
  statusId: string;
  onExit: (reason: 'select' | 'cancel') => void;
}) {
  const canSelect = reason === null;
  return (
    <footer className="flex flex-col gap-2 border-t-2 border-chatroom-border bg-chatroom-bg-surface px-3 py-2">
      <p
        id={statusId}
        className={
          reason
            ? 'min-w-0 text-xs text-chatroom-text-muted whitespace-normal'
            : 'min-w-0 text-xs font-mono text-chatroom-text-secondary break-all'
        }
      >
        {reason ?? `Folder: ${browser.listing?.path ?? ''}`}
      </p>
      <div className="flex items-center gap-2 sm:justify-end">
        <div className="flex flex-1 sm:flex-none">
          <button
            type="button"
            className={setupSecondaryButtonClassName}
            onClick={() => {
              browser.cancel();
              onExit('cancel');
            }}
          >
            Cancel
          </button>
        </div>
        <div className="flex flex-1 sm:flex-none">
          <button
            type="button"
            className={setupPrimaryButtonClassName}
            disabled={!canSelect}
            aria-describedby={!canSelect ? statusId : undefined}
            onClick={() => {
              if (!canSelect) return;
              browser.select();
              onExit('select');
            }}
          >
            Select
          </button>
        </div>
      </div>
    </footer>
  );
}

/**
 * The inline folder browser: header, navigation, filter, notices, one body and a footer with
 * Cancel and Select. Mounted only while a session is open. Escape is layered through
 * `overlayDismissStack`, so it closes this panel before any dialog or wizard around it.
 */
// fallow-ignore-next-line complexity
export function RemoteFolderBrowser({
  id,
  browser,
  loadingCaption,
  onExit,
}: RemoteFolderBrowserProps) {
  const headingId = useId();
  const statusId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The Escape handler reads the latest session, so it is registered once per `onExit`.
  const latest = useRef(browser);
  latest.current = browser;

  useEffect(() => {
    headingRef.current?.focus();
    panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  useEffect(() => {
    const dismiss = () => {
      const current = latest.current;
      if (current.filter !== '') {
        current.setFilter('');
      } else {
        current.cancel();
        onExit('cancel');
      }
    };
    pushOverlayDismiss(dismiss);
    return () => popOverlayDismiss(dismiss);
  }, [onExit]);

  const machine = browser.machineDisplayName ?? 'machine';
  const notices = noticeCopy(browser);

  return (
    <section
      ref={panelRef}
      id={id}
      role="region"
      aria-labelledby={headingId}
      aria-busy={browser.isNavigating || undefined}
      data-slot="remote-folder-browser"
      data-phase={browser.phase}
      className="flex min-h-0 flex-col border-2 border-chatroom-border bg-chatroom-bg-primary text-chatroom-text-primary"
    >
      <div className="flex min-w-0 items-center gap-2 border-b-2 border-chatroom-border bg-chatroom-bg-tertiary px-3 py-2">
        <Server size={14} aria-hidden className="shrink-0 text-chatroom-text-muted" />
        <h4
          ref={headingRef}
          id={headingId}
          tabIndex={-1}
          className="min-w-0 truncate text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted outline-none"
        >
          Browsing {machine}
        </h4>
      </div>
      <RemoteFolderBrowserNav browser={browser} />
      <RemoteFolderBrowserToolbar browser={browser} />
      <div aria-live="polite" className="sr-only">
        {liveRegionText(browser)}
      </div>
      {notices.length > 0 && (
        <div className="flex flex-col">
          {notices.map((notice) => (
            <RemoteFolderBrowserNotice
              key={notice.message}
              tone={notice.tone}
              message={notice.message}
              action={
                notice.action === 'retry'
                  ? { label: notice.actionLabel ?? 'Retry', onClick: browser.retry }
                  : undefined
              }
            />
          ))}
        </div>
      )}
      <div
        data-slot="remote-folder-browser-body"
        className="relative h-[min(18rem,50dvh)] min-h-40 overflow-y-auto border-b border-chatroom-border"
      >
        <BrowserBody
          browser={browser}
          kind={bodyKindOf(browser)}
          machine={machine}
          loadingCaption={loadingCaption}
        />
      </div>
      <BrowserFooter
        browser={browser}
        reason={selectDisabledReason(browser, machine)}
        statusId={statusId}
        onExit={onExit}
      />
    </section>
  );
}
