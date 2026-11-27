'use client';

import { Loader2 } from 'lucide-react';
import { useRef } from 'react';

import { buildCarryOverPreview } from './lib/carryOverPreview';
import { useFocusOnMount } from './useFocusOnMount';
import type { SwitchWorkspaceFlow } from './useSwitchWorkspaceFlow';

import { InlineFeedback } from '@/components/inline-feedback';
import { Checkbox } from '@/components/ui/checkbox';
import { useMachineCapabilities } from '@/hooks/useMachineCapabilities';
import { cn } from '@/lib/utils';
import {
  SetupStepFooter,
  SetupStepLayout,
  setupSecondaryButtonClassName,
} from '@/modules/chatroom/components/setup/SetupStepLayout';
import { useChatroomWorkspace } from '@/modules/chatroom/context/ChatroomWorkspaceContext';
import { IMPORT_CHECKBOX_CLASS } from '@/modules/chatroom/features/transfer/components/import/ImportEntryRow';
import { useAgentConfigs } from '@/modules/chatroom/hooks/useAgentConfigs';

const CONSEQUENCES = [
  "Running agents are stopped. Work in progress may be interrupted. The stop request is queued for the machine's daemon.",
  'The current workspace is removed from this chatroom (soft-deleted; switching back adds it again). Cached file-tree data for it is cleared.',
  'Agent configurations are carried over where possible: same role, and the harness must be available on the new machine.',
  'Agents do not start on the new workspace. Start them from the agent panel afterwards.',
  'No files are changed on either machine.',
] as const;

const switchDestructiveButtonClassName =
  'inline-flex h-10 w-full items-center justify-center gap-2 px-4 bg-chatroom-status-error text-chatroom-bg-primary text-xs font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50 sm:h-9 sm:w-auto sm:min-w-28';

/** The confirmation stage: consequences, carry-over preview, and the acknowledgement gate. */
// fallow-ignore-next-line complexity
export function SwitchWorkspaceReviewStep({ flow }: { flow: SwitchWorkspaceFlow }) {
  const { chatroomId } = useChatroomWorkspace();
  const { configs } = useAgentConfigs(chatroomId, { enabled: true });
  const target = flow.target;
  const from = flow.from;
  const {
    availableHarnesses,
    reported,
    isLoading: capsLoading,
  } = useMachineCapabilities(target?.machineId ?? null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnMount(headingRef);
  if (!target || !from) return null;

  // Unknown target data (still loading, or never reported) is null: the preview judges nothing.
  const targetHarnesses = !capsLoading && reported ? availableHarnesses : null;
  const preview = buildCarryOverPreview(
    configs,
    { machineId: from.machineId, workingDir: from.workingDir },
    targetHarnesses
  );
  const busy = flow.busy;

  return (
    <SetupStepLayout
      autoFocusFirstControl={false}
      footer={
        <SetupStepFooter
          secondary={
            <button
              type="button"
              disabled={busy}
              onClick={flow.back}
              className={setupSecondaryButtonClassName}
            >
              Back
            </button>
          }
          primary={
            <button
              type="button"
              data-testid="switch-confirm"
              disabled={!flow.acknowledged || busy}
              onClick={() => void flow.submit()}
              className={switchDestructiveButtonClassName}
            >
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Switching…
                </>
              ) : (
                'Switch workspace'
              )}
            </button>
          }
        />
      }
    >
      <div data-testid="switch-review" className="space-y-4">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="text-xs font-bold uppercase tracking-widest text-chatroom-text-primary outline-none"
        >
          Switch workspace?
        </h3>
        <dl className="space-y-1 border border-chatroom-border bg-chatroom-bg-surface p-3 text-xs">
          <div className="flex flex-wrap gap-x-3">
            <dt className="w-10 shrink-0 font-bold uppercase tracking-widest text-chatroom-text-muted">
              From
            </dt>
            <dd className="min-w-0 break-all">
              <span className="font-bold">{from.machineLabel}</span>{' '}
              <span className="font-mono text-chatroom-text-muted">{from.workingDir}</span>
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-3">
            <dt className="w-10 shrink-0 font-bold uppercase tracking-widest text-chatroom-text-muted">
              To
            </dt>
            <dd className="min-w-0 break-all">
              <span className="font-bold">{target.machineLabel}</span>{' '}
              <span className="font-mono">{target.workingDir}</span>
              {!target.connected && (
                <span className="ml-2 text-[10px] font-bold uppercase text-chatroom-text-muted">
                  Offline
                </span>
              )}
            </dd>
          </div>
        </dl>
        {!target.connected && (
          <InlineFeedback
            feedback={{
              id: 1,
              tone: 'warning',
              message: `${target.machineLabel} is offline. Agents cannot start there until its daemon runs.`,
            }}
          />
        )}
        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
            What will happen
          </h4>
          <ul className="space-y-1.5 text-xs text-chatroom-text-secondary">
            {CONSEQUENCES.map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 bg-chatroom-status-warning" />
                {line}
              </li>
            ))}
          </ul>
          {preview && (
            <div
              data-testid="switch-carry-preview"
              className="ml-3.5 space-y-1 text-xs text-chatroom-text-muted"
            >
              {capsLoading ? (
                <p>Checking target machine…</p>
              ) : !preview.targetReported ? (
                <p>
                  The new machine has not reported its harnesses, so carry-over cannot be checked.
                </p>
              ) : (
                <>
                  {preview.expected.length > 0 && (
                    <p>Expected to carry over: {preview.expected.join(', ')}</p>
                  )}
                  {preview.atRisk.length > 0 && (
                    <p className="text-chatroom-status-warning">
                      May not carry over:{' '}
                      {preview.atRisk
                        .map((r) => `${r.role} (${r.harness} not on the new machine)`)
                        .join(', ')}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>
        <label className="flex items-start gap-2 text-xs font-bold text-chatroom-text-primary">
          <Checkbox
            data-testid="switch-ack"
            checked={flow.acknowledged}
            disabled={busy}
            onCheckedChange={(value) => flow.setAcknowledged(value === true)}
            className={cn(IMPORT_CHECKBOX_CLASS, 'mt-0.5')}
          />
          I understand running agents will be stopped.
        </label>
        {flow.error && flow.error.kind !== 'conflict' && flow.error.kind !== 'invalid-path' && (
          <InlineFeedback
            data-testid="switch-error"
            feedback={{ id: 1, tone: 'error', message: flow.error.message }}
          />
        )}
      </div>
    </SetupStepLayout>
  );
}
