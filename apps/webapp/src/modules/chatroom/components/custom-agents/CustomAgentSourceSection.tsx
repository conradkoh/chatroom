'use client';

/**
 * One source folder: scope chip, root path, push summary, and the issue list.
 *
 * Presentational. Copy comes from `customAgentCopy.ts`; the push time is
 * relative so it stays fresh without new queries.
 */

import { AlertTriangle, Check, Info } from 'lucide-react';
import type { ReactNode } from 'react';

import {
  CUSTOM_AGENT_ISSUE_COPY,
  CUSTOM_AGENTS_GITIGNORE_SNIPPET,
  formatCustomAgentIssueDetail,
} from './customAgentCopy';
import { CustomAgentsSnippet } from './CustomAgentsEmptyState';
import type { CustomAgentSourceModel } from './customAgentsViewModel';
import { useRelativeTime } from '../../hooks/useRelativeTime';

export interface CustomAgentSourceSectionProps {
  source: CustomAgentSourceModel;
}

export function CustomAgentSourceSection({ source }: CustomAgentSourceSectionProps) {
  return (
    <section
      data-testid={`custom-agent-source-${source.scope}`}
      className="border border-chatroom-border bg-chatroom-bg-surface"
    >
      <SourceHeader source={source} />
      <SourceStatus source={source} />
      <SourceIssues issues={source.issues} />
    </section>
  );
}

function SourceHeader({ source }: { source: CustomAgentSourceModel }): ReactNode {
  const relative = useRelativeTime(source.pushed?.updatedAt);

  return (
    <header className="flex flex-col gap-1 border-b border-chatroom-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-chatroom-bg-tertiary text-chatroom-text-muted">
          {source.scope === 'workspace' ? 'Workspace' : 'Machine'}
        </span>
        <code
          className="min-w-0 truncate font-mono text-[11px] text-chatroom-text-secondary"
          title={source.rootPath}
        >
          {source.rootPath}
        </code>
      </div>
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide tabular-nums text-chatroom-text-muted">
        {pushSummary(source.pushed, relative)}
      </span>
    </header>
  );
}

function pushSummary(pushed: CustomAgentSourceModel['pushed'], relative: string): string {
  if (pushed === null) return 'Nothing pushed yet';
  const noun = pushed.agentCount === 1 ? 'agent' : 'agents';
  return `${pushed.agentCount} ${noun} · pushed ${relative}`;
}

function SourceStatus({ source }: { source: CustomAgentSourceModel }): ReactNode {
  if (source.pushed === null) {
    return (
      <p className="px-3 py-2 text-[11px] text-chatroom-text-muted">
        The daemon has not pushed this folder. It may be empty.
      </p>
    );
  }
  if (source.issues.length > 0) return null;
  return (
    <p className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-chatroom-status-success">
      <Check size={12} aria-hidden />
      No problems
    </p>
  );
}

function SourceIssues({ issues }: { issues: CustomAgentSourceModel['issues'] }): ReactNode {
  if (issues.length === 0) return null;
  return (
    <ul className="divide-y divide-chatroom-border">
      {issues.map((issue, index) => (
        <IssueRow key={`${issue.reason}:${issue.path}:${index}`} issue={issue} />
      ))}
    </ul>
  );
}

function IssueRow({ issue }: { issue: CustomAgentSourceModel['issues'][number] }): ReactNode {
  const copy = CUSTOM_AGENT_ISSUE_COPY[issue.reason];
  const detail = formatCustomAgentIssueDetail(issue);

  return (
    <li
      data-testid="custom-agent-issue"
      data-reason={issue.reason}
      className="flex items-start gap-2 px-3 py-2"
    >
      <IssueIcon tone={copy.tone} />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-[11px] font-bold text-chatroom-text-primary">{copy.title}</p>
        <p className="font-mono text-[10px] text-chatroom-text-secondary break-all">
          {issue.path}
          {detail && <span className="text-chatroom-text-muted"> · {detail}</span>}
        </p>
        <p className="text-[11px] leading-4 text-chatroom-text-muted">{copy.action}</p>
        {issue.reason === 'gitignored' && (
          <CustomAgentsSnippet
            label="Replace a bare .chatroom rule with"
            text={CUSTOM_AGENTS_GITIGNORE_SNIPPET}
          />
        )}
      </div>
    </li>
  );
}

function IssueIcon({ tone }: { tone: 'warning' | 'info' }): ReactNode {
  if (tone === 'info') {
    return <Info size={12} className="mt-0.5 shrink-0 text-chatroom-status-info" aria-hidden />;
  }
  return (
    <AlertTriangle size={12} className="mt-0.5 shrink-0 text-chatroom-status-warning" aria-hidden />
  );
}
