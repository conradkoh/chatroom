// fallow-ignore-file unused-file unused-export
'use client';

/**
 * One custom-agent row: name, scope chips, description, and the enable switch.
 *
 * Presentational only. The switch reflects the roster (`row.disabled`) and, while
 * a change is pending, the requested position; it never shows an optimistic
 * result. `readOnly` — not `disabled` — keeps keyboard focus while pending.
 *
 * Temporary: S6c mounts this tab and removes this marker.
 */

import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

import type { CustomAgentRowModel } from './customAgentsViewModel';
import type { CustomAgentToggleState } from './useCustomAgentToggle';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

export interface CustomAgentRowProps {
  row: CustomAgentRowModel;
  toggle: CustomAgentToggleState;
  controlsDisabled: boolean;
  onToggle: (name: string, desiredDisabled: boolean) => void;
}

export function CustomAgentRow({ row, toggle, controlsDisabled, onToggle }: CustomAgentRowProps) {
  const pending = toggle.kind === 'pending';
  // The switch is "on" when the agent is enabled.
  const checked = pending ? !toggle.desiredDisabled : !row.disabled;

  return (
    <li
      data-testid={`custom-agent-row-${row.name}`}
      aria-busy={busyAttribute(pending)}
      className="flex min-h-[4.75rem] items-start gap-3 p-3 border border-chatroom-border bg-chatroom-bg-surface"
    >
      <RowText row={row} failure={failureOf(toggle)} />
      <SwitchCell
        row={row}
        checked={checked}
        pending={pending}
        desiredDisabled={pending ? toggle.desiredDisabled : false}
        controlsDisabled={controlsDisabled}
        onToggle={onToggle}
      />
    </li>
  );
}

/** `true` while pending, otherwise absent, so the row is not announced as busy when idle. */
function busyAttribute(pending: boolean): true | undefined {
  return pending ? true : undefined;
}

function failureOf(toggle: CustomAgentToggleState): string | null {
  return toggle.kind === 'failed' ? toggle.message : null;
}

function RowText({
  row,
  failure,
}: {
  row: CustomAgentRowModel;
  failure: string | null;
}): ReactNode {
  return (
    <div className="min-w-0 flex-1">
      <div className={cn(row.disabled && 'opacity-60')}>
        <RowTitleLine row={row} />
        <p
          className="mt-1 text-[11px] leading-4 text-chatroom-text-secondary line-clamp-2"
          title={row.description}
        >
          {row.description}
        </p>
      </div>
      {failure !== null && <FailureMessage message={failure} />}
    </div>
  );
}

function RowTitleLine({ row }: { row: CustomAgentRowModel }): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-xs font-bold leading-4 text-chatroom-text-primary break-all">
        {row.name}
      </span>
      <ScopeChip scope={row.scope} />
      {row.overridesMachineCopy && <OverridesChip />}
      {row.disabled && <OffChip />}
    </div>
  );
}

function ScopeChip({ scope }: { scope: CustomAgentRowModel['scope'] }): ReactNode {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-chatroom-bg-tertiary text-chatroom-text-muted">
      {scope === 'workspace' ? 'Workspace' : 'Machine'}
    </span>
  );
}

function OverridesChip(): ReactNode {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-chatroom-status-info/10 text-chatroom-status-info">
      Overrides machine
    </span>
  );
}

function OffChip(): ReactNode {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-chatroom-border text-chatroom-text-muted">
      Off
    </span>
  );
}

function FailureMessage({ message }: { message: string }): ReactNode {
  return (
    <p
      role="alert"
      className="mt-1.5 flex items-start gap-1 text-[10px] font-bold text-chatroom-status-error"
    >
      <AlertTriangle size={12} className="mt-px shrink-0" aria-hidden />
      {message}
    </p>
  );
}

function SwitchCell({
  row,
  checked,
  pending,
  desiredDisabled,
  controlsDisabled,
  onToggle,
}: {
  row: CustomAgentRowModel;
  checked: boolean;
  pending: boolean;
  desiredDisabled: boolean;
  controlsDisabled: boolean;
  onToggle: (name: string, desiredDisabled: boolean) => void;
}): ReactNode {
  return (
    <div className="flex shrink-0 items-center gap-2 pt-0.5">
      <PendingLabel pending={pending} desiredDisabled={desiredDisabled} />
      <Switch
        data-testid={`custom-agent-switch-${row.name}`}
        checked={checked}
        readOnly={pending}
        aria-busy={busyAttribute(pending)}
        disabled={controlsDisabled || !row.disableable}
        aria-label={`Enable ${row.name}`}
        onCheckedChange={(next) => onToggle(row.name, !next)}
      />
    </div>
  );
}

function PendingLabel({
  pending,
  desiredDisabled,
}: {
  pending: boolean;
  desiredDisabled: boolean;
}): ReactNode {
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted"
    >
      {pending && (
        <>
          <Loader2 size={12} className="animate-spin" aria-hidden />
          <span className="sr-only sm:not-sr-only">
            {desiredDisabled ? 'Turning off…' : 'Turning on…'}
          </span>
        </>
      )}
    </span>
  );
}
