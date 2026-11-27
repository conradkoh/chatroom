'use client';

import { AlertTriangle, Check, Minus } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import type { ImportViewState } from '../../hooks/useTransferImport';
import { closeUnlessModified } from '../../lib/closeUnlessModified';
import { deriveImportRows, type ImportRow } from '../../lib/importRows';
import {
  chatroomLabel,
  IMPORT_ATTACHMENTS_NOTE,
  importFailureNote,
  importNotStartedCopy,
  importSummaryLine,
  pluralize,
} from '../../lib/transferCopy';

import { InlineFeedback } from '@/components/inline-feedback';
import { Button } from '@/components/ui/button';
import { DialogFooter, DialogScrollBody } from '@/components/ui/dialog';
import { chatroomIndustrialDialogFooterClassName } from '@/modules/chatroom/components/shared/industrialDialogStyles';

type DoneState = Extract<ImportViewState, { kind: 'done' }>;

interface ImportResultStepProps {
  state: DoneState;
  onRetry(): void;
  /** A result link was clicked on a plain click. */
  onClose(): void;
}

/** The results step: counts and one section per outcome. */
// fallow-ignore-next-line complexity
export function ImportResultStep({ state, onRetry, onClose }: ImportResultStepProps) {
  const { summary } = state;
  const rows = deriveImportRows(state.listing, state.keys, null, summary.results, false);
  const imported = rows.filter((row) => row.status.kind === 'imported');
  const failed = rows.filter((row) => row.status.kind === 'failed');
  const skipped = rows.filter((row) => row.status.kind === 'skipped');

  return (
    <>
      <DialogScrollBody className="min-h-0 flex-1 space-y-3">
        <p
          role="status"
          data-testid="import-summary"
          className="text-xs font-bold text-chatroom-text-primary"
        >
          {importSummaryLine({
            imported: summary.imported,
            selected: state.keys.length,
            failed: summary.failed,
            skipped: summary.skipped,
          })}
        </p>
        {summary.fatal !== null && (
          <InlineFeedback
            feedback={{
              id: 1,
              tone: 'error',
              title: 'Import stopped',
              message: summary.fatal.message,
            }}
          />
        )}
        {imported.length > 0 && (
          <ResultSection heading={`Imported (${imported.length})`} testId="import-results-imported">
            {imported.map((row) => (
              <ResultRow key={row.entry.key} testId="import-result-imported">
                <Check size={14} className="shrink-0 text-chatroom-status-success" aria-hidden />
                <RowName name={row.entry.name} />
                {row.status.kind === 'imported' && (
                  <OpenLink chatroomId={row.status.chatroomId} onClose={onClose} />
                )}
              </ResultRow>
            ))}
            <p className="text-[10px] text-chatroom-text-muted">{IMPORT_ATTACHMENTS_NOTE}</p>
          </ResultSection>
        )}
        {failed.length > 0 && (
          <ResultSection heading={`Failed (${failed.length})`} testId="import-results-failed">
            {failed.map((row) => (
              <FailedRow key={row.entry.key} row={row} onClose={onClose} />
            ))}
          </ResultSection>
        )}
        {skipped.length > 0 && (
          <ResultSection
            heading={`Not started (${skipped.length})`}
            testId="import-results-skipped"
          >
            {skipped.map((row) => (
              <ResultRow key={row.entry.key} testId="import-result-skipped">
                <Minus size={14} className="shrink-0" aria-hidden />
                <RowName name={row.entry.name} />
                <span className="ml-auto text-[10px] text-chatroom-text-muted">
                  {row.status.kind === 'skipped' ? importNotStartedCopy(row.status.reason) : null}
                </span>
              </ResultRow>
            ))}
          </ResultSection>
        )}
      </DialogScrollBody>
      <DialogFooter className={chatroomIndustrialDialogFooterClassName}>
        {summary.failed + summary.skipped > 0 && (
          <Button variant="secondary" onClick={onRetry} data-testid="import-retry">
            Retry {pluralize(summary.failed + summary.skipped, 'remaining')}
          </Button>
        )}
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </>
  );
}

function ResultSection({
  heading,
  testId,
  children,
}: {
  heading: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className="space-y-1">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
        {heading}
      </h3>
      <ul className="divide-y divide-chatroom-border border border-chatroom-border">{children}</ul>
    </section>
  );
}

function ResultRow({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <li data-testid={testId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-xs">
      {children}
    </li>
  );
}

function RowName({ name }: { name: string | null }) {
  return (
    <span className="min-w-0 truncate font-bold uppercase tracking-wide">
      {chatroomLabel(name)}
    </span>
  );
}

function OpenLink({ chatroomId, onClose }: { chatroomId: string; onClose(): void }) {
  return (
    <Link
      href={`/app/chatroom?id=${chatroomId}`}
      onClick={(event) => closeUnlessModified(event, onClose)}
      className="text-[10px] font-bold uppercase text-chatroom-accent hover:underline"
    >
      Open →
    </Link>
  );
}

/** One failed entry: the code, the message, and what happened to any rows it wrote. */
function FailedRow({ row, onClose }: { row: ImportRow; onClose: () => void }) {
  if (row.status.kind !== 'failed') return null;
  const { code, message, orphanChatroomId } = row.status;
  return (
    <li
      data-testid="import-result-failed"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-xs"
    >
      <AlertTriangle size={14} className="shrink-0 text-chatroom-status-error" aria-hidden />
      <RowName name={row.entry.name} />
      <span className="min-w-0 break-words text-[10px] text-chatroom-text-muted sm:text-right">
        {code} — {message}
      </span>
      <p className="basis-full text-[10px] text-chatroom-text-muted">
        {importFailureNote({ rolledBack: row.status.rolledBack, orphanChatroomId })}
        {orphanChatroomId !== undefined && (
          <>
            {' '}
            <OpenLink chatroomId={orphanChatroomId} onClose={onClose} />
          </>
        )}
      </p>
    </li>
  );
}
