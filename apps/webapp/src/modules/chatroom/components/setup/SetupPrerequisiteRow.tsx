'use client';

import { Check } from 'lucide-react';

import { CopyButton } from '../CopyButton';

export interface SetupPrerequisiteRowProps {
  done: boolean;
  label: string;
  command?: string;
  doneDetail?: string;
}

export function SetupPrerequisiteRow({
  done,
  label,
  command,
  doneDetail,
}: SetupPrerequisiteRowProps) {
  if (done) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-chatroom-status-success">
          <Check size={14} />
        </span>
        <span className="text-xs font-medium text-chatroom-status-success">{label}</span>
        {doneDetail && <span className="text-xs text-chatroom-text-muted">— {doneDetail}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4 border border-chatroom-border bg-chatroom-bg-surface">
      <div className="flex items-center gap-2">
        <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center text-chatroom-text-muted">
          <span className="w-1.5 h-1.5 bg-chatroom-status-warning " />
        </span>
        <span className="text-sm font-semibold text-chatroom-text-primary">{label}</span>
      </div>
      {command && (
        <div className="ml-6 flex items-start gap-2 p-3 bg-chatroom-bg-primary">
          <pre className="font-mono text-xs text-chatroom-text-secondary flex-1 whitespace-pre-wrap">
            {command}
          </pre>
          <CopyButton text={command} label="Copy" copiedLabel="Copied!" variant="compact" />
        </div>
      )}
    </div>
  );
}
