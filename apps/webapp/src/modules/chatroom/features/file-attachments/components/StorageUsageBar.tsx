'use client';

// fallow-ignore-file unused-file
import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { formatFileSize } from '../lib/formatFileSize';

import { ProgressIndicator, ProgressTrack } from '@/components/ui/progress';

export interface StorageUsageBarProps {
  usedBytes: number;
  fileCount: number;
  /** Configured quota of this scope (user quota or chatroom quota). */
  limitBytes: number;
  /** Chatroom only: the user cap when it is below the chatroom quota. */
  effectiveLimitBytes?: number;
  isDefault: boolean;
}

/**
 * Colour follows usage against the effective limit: accent below 80%, warning
 * from 80% to 100%, error above 100%. The bar itself is scaled to the larger of
 * the limit and the usage, so over-quota usage still reads as full; the marker
 * shows where a chatroom cap sits inside a larger configured quota.
 */
function toneFor(usedBytes: number, effectiveLimitBytes: number): string {
  if (usedBytes > effectiveLimitBytes) return 'bg-chatroom-status-error';
  if (usedBytes >= 0.8 * effectiveLimitBytes) return 'bg-chatroom-status-warning';
  return 'bg-chatroom-accent';
}

/** A zero limit has no percentage; avoid dividing by zero. */
function percentageOf(usedBytes: number, effectiveLimitBytes: number): number {
  if (effectiveLimitBytes === 0) return 0;
  return Math.round((usedBytes / effectiveLimitBytes) * 100);
}

/** The chatroom cap wins only when it is below the configured quota. */
function resolveEffectiveLimit(limitBytes: number, effectiveLimitBytes?: number): number {
  return effectiveLimitBytes ?? limitBytes;
}

export function StorageUsageBar({
  usedBytes,
  fileCount,
  limitBytes,
  effectiveLimitBytes,
  isDefault,
}: StorageUsageBarProps) {
  const effective = resolveEffectiveLimit(limitBytes, effectiveLimitBytes);
  const capped = effective < limitBytes;
  const scale = Math.max(limitBytes, usedBytes, 1);

  return (
    <div data-testid="storage-usage" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-chatroom-text-primary">
          <span className="font-bold">{formatFileSize(usedBytes)}</span> of{' '}
          {formatFileSize(effective)} used · {fileCount} files
        </span>
        <span className="flex items-center gap-2">
          {isDefault && (
            <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-chatroom-bg-tertiary text-chatroom-text-muted">
              Default
            </span>
          )}
          <span className="tabular-nums text-chatroom-text-muted">
            {percentageOf(usedBytes, effective)}%
          </span>
        </span>
      </div>
      <ProgressPrimitive.Root value={(usedBytes / scale) * 100} aria-label="Storage usage">
        <ProgressTrack className="relative h-2 rounded-none bg-chatroom-bg-tertiary">
          <ProgressIndicator className={toneFor(usedBytes, effective)} />
          {capped && (
            <span
              data-testid="storage-effective-marker"
              className="absolute inset-y-0 w-0.5 bg-chatroom-text-primary"
              style={{ left: `${(effective / scale) * 100}%` }}
            />
          )}
        </ProgressTrack>
      </ProgressPrimitive.Root>
      {capped && (
        <p className="text-[11px] text-chatroom-status-warning">
          Capped at {formatFileSize(effective)} by your account limit.
        </p>
      )}
      <p className="text-[11px] text-chatroom-text-muted">Includes files still uploading.</p>
    </div>
  );
}
