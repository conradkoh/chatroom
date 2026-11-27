'use client';

import { AlertTriangle } from 'lucide-react';
import { useRef } from 'react';

import { CONFLICT_COPY } from './lib/switchWorkspaceCopy';
import { SwitchWorkspaceChooseStep } from './SwitchWorkspaceChooseStep';
import { SwitchWorkspaceResultStep } from './SwitchWorkspaceResultStep';
import { SwitchWorkspaceReviewStep } from './SwitchWorkspaceReviewStep';
import { useFocusOnMount } from './useFocusOnMount';
import type { SwitchWorkspaceFlow as Flow } from './useSwitchWorkspaceFlow';

import {
  SetupStepFooter,
  SetupStepLayout,
  setupPrimaryButtonClassName,
  setupSecondaryButtonClassName,
} from '@/modules/chatroom/components/setup/SetupStepLayout';
import type { SwitchWorkspaceResult } from '@/modules/chatroom/context/ChatroomWorkspaceContext';

export interface SwitchWorkspaceFlowProps {
  flow: Flow;
  /** 'Done' in the dialog, 'Continue to agent team' in the checklist. */
  doneLabel: string;
  /** Choose-stage Cancel and conflict-panel Cancel. */
  onCancel(): void;
  onDone(result: SwitchWorkspaceResult): void;
}

/** Presentational stage switch, shared by the dialog shell and the setup checklist. */
// fallow-ignore-next-line complexity
export function SwitchWorkspaceFlow({
  flow,
  doneLabel,
  onCancel,
  onDone,
}: SwitchWorkspaceFlowProps) {
  if (flow.stage === 'choose') {
    return <SwitchWorkspaceChooseStep flow={flow} onCancel={onCancel} />;
  }
  if (flow.stage === 'done' && flow.result) {
    return (
      <SwitchWorkspaceResultStep
        flow={flow}
        result={flow.result}
        doneLabel={doneLabel}
        onDone={onDone}
      />
    );
  }
  if (flow.stale || flow.error?.kind === 'conflict') {
    return (
      <ConflictPanel
        message={flow.error?.message ?? CONFLICT_COPY}
        onCancel={onCancel}
        onReviewCurrent={flow.reviewCurrent}
      />
    );
  }
  return <SwitchWorkspaceReviewStep flow={flow} />;
}

function ConflictPanel({
  message,
  onCancel,
  onReviewCurrent,
}: {
  message: string;
  onCancel(): void;
  onReviewCurrent(): void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useFocusOnMount(headingRef);
  return (
    <SetupStepLayout
      autoFocusFirstControl={false}
      footer={
        <SetupStepFooter
          secondary={
            <button type="button" className={setupSecondaryButtonClassName} onClick={onCancel}>
              Cancel
            </button>
          }
          primary={
            <button type="button" className={setupPrimaryButtonClassName} onClick={onReviewCurrent}>
              Review current workspace
            </button>
          }
        />
      }
    >
      <div data-testid="switch-conflict" role="alert" className="space-y-2">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-chatroom-status-warning outline-none"
        >
          <AlertTriangle size={14} />
          The workspace changed
        </h3>
        <p className="text-xs text-chatroom-text-muted">{message}</p>
      </div>
    </SetupStepLayout>
  );
}
