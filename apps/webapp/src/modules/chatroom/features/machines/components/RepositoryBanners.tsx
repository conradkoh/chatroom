'use client';

import { LEDGER_MAX_ENTRIES } from '@workspace/backend/src/domain/entities/repository-ledger';

import { LedgerNotice } from './LedgerNotice';
import type { LedgerRootSummary, LedgerSnapshotMeta } from '../hooks/useRepositoryLedger';

export interface RepositoryBannersProps {
  snapshot: LedgerSnapshotMeta;
  /** false shows the stale note; undefined (still resolving) shows nothing. */
  connected: boolean | undefined;
  /** The machine's current project root paths; undefined while the roots query loads. */
  currentRootPaths: readonly string[] | undefined;
}

interface Banner {
  testId: string;
  text: string;
}

function truncatedBanner({ truncated }: LedgerSnapshotMeta): Banner | null {
  if (!truncated) return null;
  return {
    testId: 'ledger-banner-truncated',
    text: `Showing the first ${LEDGER_MAX_ENTRIES.toLocaleString('en-US')} repositories. Narrow your project roots to see the rest.`,
  };
}

/** "1 root was not found on this machine: /a" or "2 roots were not readable on this machine: …". */
function rootIssueBanner(
  roots: LedgerRootSummary[],
  status: 'missing' | 'unreadable'
): Banner | null {
  const paths = roots.filter((root) => root.status === status).map((root) => root.path);
  if (paths.length === 0) return null;
  const subject = paths.length === 1 ? '1 root was' : `${paths.length} roots were`;
  const verb = status === 'missing' ? 'not found' : 'not readable';
  return {
    testId: `ledger-banner-roots-${status}`,
    text: `${subject} ${verb} on this machine: ${paths.join(', ')}`,
  };
}

function sameRootPaths(snapshotPaths: readonly string[], currentPaths: readonly string[]): boolean {
  return (
    snapshotPaths.length === currentPaths.length &&
    snapshotPaths.every((p) => currentPaths.includes(p))
  );
}

function rootsChangedBanner(
  { roots }: LedgerSnapshotMeta,
  currentRootPaths: readonly string[] | undefined
): Banner | null {
  if (currentRootPaths === undefined) return null;
  if (
    sameRootPaths(
      roots.map((root) => root.path),
      currentRootPaths
    )
  )
    return null;
  return {
    testId: 'ledger-banner-roots-changed',
    text: 'Project roots changed since this snapshot. Rescan to refresh.',
  };
}

function staleBanner(connected: boolean | undefined): Banner | null {
  if (connected !== false) return null;
  return {
    testId: 'ledger-banner-stale',
    text: 'Machine is offline. This snapshot may be out of date.',
  };
}

function omittedBanner({ invalidPathCount }: LedgerSnapshotMeta): Banner | null {
  if (invalidPathCount <= 0) return null;
  const subject = invalidPathCount === 1 ? '1 entry is' : `${invalidPathCount} entries are`;
  return {
    testId: 'ledger-banner-omitted',
    text: `${subject} left out of this snapshot: invalid, over-long, or duplicate paths.`,
  };
}

/** Active banners in display order. */
function activeBanners({
  snapshot,
  connected,
  currentRootPaths,
}: RepositoryBannersProps): Banner[] {
  const candidates: (Banner | null)[] = [
    truncatedBanner(snapshot),
    rootIssueBanner(snapshot.roots, 'missing'),
    rootIssueBanner(snapshot.roots, 'unreadable'),
    rootsChangedBanner(snapshot, currentRootPaths),
    staleBanner(connected),
    omittedBanner(snapshot),
  ];
  return candidates.filter((banner): banner is Banner => banner !== null);
}

export function RepositoryBanners(props: RepositoryBannersProps) {
  return (
    <>
      {activeBanners(props).map((banner) => (
        <LedgerNotice key={banner.testId} testId={banner.testId}>
          {banner.text}
        </LedgerNotice>
      ))}
    </>
  );
}
