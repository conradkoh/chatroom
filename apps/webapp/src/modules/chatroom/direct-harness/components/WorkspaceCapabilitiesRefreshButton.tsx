'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { Check, RefreshCw } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { useRefreshCapabilities } from '../hooks/useRefreshCapabilities';

const SUCCESS_TICK_MS = 1000;
const REFRESH_TIMEOUT_MS = 8000;

// fallow-ignore-next-line complexity
export const WorkspaceCapabilitiesRefreshButton = memo(function WorkspaceCapabilitiesRefreshButton({
  workspaceId,
  disabled = false,
  hasProviders = false,
}: {
  workspaceId: string;
  disabled?: boolean;
  /** When true, a refresh that started with no providers can end early on success. */
  hasProviders?: boolean;
}) {
  const { refresh } = useRefreshCapabilities();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSuccessTick, setShowSuccessTick] = useState(false);
  const hadProvidersOnClickRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (successTickRef.current) {
      clearTimeout(successTickRef.current);
      successTickRef.current = null;
    }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const finishRefresh = useCallback(
    (showSuccess: boolean) => {
      clearTimers();
      setIsRefreshing(false);
      if (!showSuccess) return;
      setShowSuccessTick(true);
      successTickRef.current = setTimeout(() => {
        setShowSuccessTick(false);
        successTickRef.current = null;
      }, SUCCESS_TICK_MS);
    },
    [clearTimers]
  );

  useEffect(() => {
    if (!isRefreshing || hadProvidersOnClickRef.current) return;
    if (hasProviders) {
      finishRefresh(true);
    }
  }, [finishRefresh, hasProviders, isRefreshing]);

  const canClick = Boolean(workspaceId) && !disabled && !isRefreshing && !showSuccessTick;

  const handleClick = useCallback(() => {
    if (!canClick) return;
    hadProvidersOnClickRef.current = hasProviders;
    setIsRefreshing(true);
    refresh(workspaceId as Id<'chatroom_workspaces'>);
    timeoutRef.current = setTimeout(
      () => finishRefresh(hadProvidersOnClickRef.current),
      REFRESH_TIMEOUT_MS
    );
  }, [canClick, finishRefresh, hasProviders, refresh, workspaceId]);

  const title = !workspaceId
    ? 'Workspace required to refresh models.'
    : disabled
      ? 'Cannot refresh while a query is running.'
      : isRefreshing
        ? 'Refreshing harnesses and models…'
        : showSuccessTick
          ? 'Harness and model list refreshed.'
          : 'Refresh harness and model list from daemon';

  const buttonClassName = [
    'touch-manipulation inline-flex h-8 w-8 sm:h-7 sm:w-7 items-center justify-center rounded-none border-2 transition-opacity duration-100',
    canClick &&
      'border-chatroom-border bg-chatroom-bg-surface text-chatroom-accent hover:opacity-90 active:opacity-80',
    showSuccessTick &&
      'border-chatroom-border bg-chatroom-bg-surface text-chatroom-status-success cursor-default',
    !canClick &&
      !showSuccessTick &&
      'border-chatroom-border bg-chatroom-bg-tertiary/40 text-chatroom-text-muted cursor-not-allowed opacity-80',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canClick}
      className={buttonClassName}
      title={title}
      aria-label={
        showSuccessTick ? 'Harness and model list refreshed' : 'Refresh harness and model list'
      }
      aria-disabled={!canClick}
      data-testid="workspace-capabilities-refresh-button"
    >
      {showSuccessTick ? (
        <Check
          size={14}
          strokeWidth={2}
          className="shrink-0 text-chatroom-status-success"
          aria-hidden
        />
      ) : (
        <RefreshCw
          size={14}
          strokeWidth={2}
          className={`shrink-0 ${isRefreshing ? 'animate-spin' : ''}`}
          aria-hidden
        />
      )}
    </button>
  );
});
