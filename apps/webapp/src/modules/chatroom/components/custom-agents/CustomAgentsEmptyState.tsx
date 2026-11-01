'use client';

/**
 * The "no agents yet" panel: where agents live, an example file, and the
 * gitignore rule that keeps them committable.
 *
 * Also exports `CustomAgentsSnippet`, which the source section reuses for the
 * gitignored issue.
 */

import { CopyButton } from '../CopyButton';
import { CUSTOM_AGENT_EXAMPLE_FILE, CUSTOM_AGENTS_GITIGNORE_SNIPPET } from './customAgentCopy';
import { MACHINE_AGENTS_ROOT } from './customAgentsViewModel';

export interface CustomAgentsEmptyStateProps {
  workspaceRoot: string;
  hasIssues: boolean;
}

export function CustomAgentsEmptyState({ workspaceRoot, hasIssues }: CustomAgentsEmptyStateProps) {
  const title = hasIssues ? 'No custom agents loaded' : 'No custom agents yet';
  const description = hasIssues
    ? 'Fix the problems under Sources, or add an agent:'
    : 'Add a folder with an AGENT.md file in either place. New files appear here within about a minute, or press Rescan.';

  return (
    <div
      data-testid="custom-agents-empty"
      className="space-y-4 p-4 border border-chatroom-border bg-chatroom-bg-tertiary"
    >
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-chatroom-text-primary">
          {title}
        </p>
        <p className="mt-1 text-[11px] text-chatroom-text-muted">{description}</p>
      </div>
      <CustomAgentsPathRow
        label="Workspace · shared through git"
        display={`${workspaceRoot}/<name>/AGENT.md`}
        copyText={workspaceRoot}
      />
      <CustomAgentsPathRow
        label="Machine · this computer only"
        display={`${MACHINE_AGENTS_ROOT}/<name>/AGENT.md`}
        copyText={MACHINE_AGENTS_ROOT}
      />
      <CustomAgentsSnippet label="AGENT.md example" text={CUSTOM_AGENT_EXAMPLE_FILE} />
      <CustomAgentsSnippet
        label="If .gitignore ignores .chatroom, use"
        text={CUSTOM_AGENTS_GITIGNORE_SNIPPET}
      />
    </div>
  );
}

function CustomAgentsPathRow({
  label,
  display,
  copyText,
}: {
  label: string;
  display: string;
  copyText: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
        {label}
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-[10px] text-chatroom-text-secondary bg-chatroom-bg-surface px-2 py-1.5 border border-chatroom-border break-all">
          {display}
        </code>
        <CopyButton text={copyText} label="Copy folder" copiedLabel="Copied!" variant="compact" />
      </div>
    </div>
  );
}

/** A labelled block of copyable text, used for the example file and gitignore. */
export function CustomAgentsSnippet({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
          {label}
        </p>
        <CopyButton text={text} label="Copy" copiedLabel="Copied!" variant="compact" />
      </div>
      <pre className="font-mono text-[10px] leading-relaxed text-chatroom-text-secondary bg-chatroom-bg-surface p-2 border border-chatroom-border whitespace-pre-wrap break-all">
        {text}
      </pre>
    </div>
  );
}
