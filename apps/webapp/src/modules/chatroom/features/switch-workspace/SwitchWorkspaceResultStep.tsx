'use client';

import { useRef } from 'react';

import {
  NOT_STARTED_LINE,
  SKIP_REASON_COPY,
  stopSummaryLine,
  UNCHANGED_LINE,
} from './lib/switchWorkspaceCopy';
import { useFocusOnMount } from './useFocusOnMount';
import type { SwitchWorkspaceFlow } from './useSwitchWorkspaceFlow';

import { InlineFeedback } from '@/components/inline-feedback';
import {
  SetupStepFooter,
  SetupStepLayout,
  setupPrimaryButtonClassName,
} from '@/modules/chatroom/components/setup/SetupStepLayout';
import type { SwitchWorkspaceResult } from '@/modules/chatroom/context/ChatroomWorkspaceContext';

/** The honest outcome: what switched, what was carried over, what was skipped. */
// fallow-ignore-next-line complexity
export function SwitchWorkspaceResultStep({
  flow,
  result,
  doneLabel,
  onDone,
}: {
  flow: SwitchWorkspaceFlow;
  result: SwitchWorkspaceResult;
  doneLabel: string;
  onDone(result: SwitchWorkspaceResult): void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnMount(headingRef);
  const machineLabel = flow.target?.machineLabel ?? result.machineId;
  return (
    <SetupStepLayout
      autoFocusFirstControl={false}
      footer={
        <SetupStepFooter
          primary={
            <button
              type="button"
              className={setupPrimaryButtonClassName}
              onClick={() => onDone(result)}
            >
              {doneLabel}
            </button>
          }
        />
      }
    >
      <div data-testid="switch-result" className="space-y-3">
        <h3 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
          Switch result
        </h3>
        {result.outcome === 'unchanged' ? (
          <InlineFeedback
            feedback={{ id: 1, tone: 'info', title: 'Nothing changed', message: UNCHANGED_LINE }}
          />
        ) : (
          <>
            <InlineFeedback
              feedback={{
                id: 1,
                tone: 'success',
                title: 'Workspace switched',
                message: `This chatroom now uses ${machineLabel} · ${result.workingDir}.`,
                items: [stopSummaryLine(result.agentsStopRequested), NOT_STARTED_LINE],
              }}
            />
            {result.configsMigrated.length > 0 && (
              <section data-testid="switch-result-migrated" className="space-y-1">
                <h4 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
                  Carried over ({result.configsMigrated.length})
                </h4>
                <p className="font-mono text-xs text-chatroom-status-success">
                  {result.configsMigrated.join(' · ')}
                </p>
              </section>
            )}
            {result.configsSkipped.length > 0 && (
              <section data-testid="switch-result-skipped" className="space-y-1">
                <h4 className="text-xs font-bold uppercase tracking-widest text-chatroom-text-muted">
                  Not carried over ({result.configsSkipped.length})
                </h4>
                <ul className="divide-y divide-chatroom-border border border-chatroom-border text-xs">
                  {result.configsSkipped.map((skip) => (
                    <li key={skip.role} className="flex flex-wrap gap-x-3 p-2">
                      <span className="font-mono font-bold">{skip.role}</span>
                      <span className="text-chatroom-status-warning">
                        {SKIP_REASON_COPY[skip.reason]}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </SetupStepLayout>
  );
}
