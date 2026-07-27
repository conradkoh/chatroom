'use client';

import { memo } from 'react';

import type { HandoffSeverity } from '../../utils/handoffSeverity';
import { getSeverityChipClassName, getSeverityLabel } from '../../utils/handoffSeverity';

export const SeverityChip = memo(function SeverityChip({
  severity,
}: {
  severity: HandoffSeverity;
}) {
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border rounded-sm mr-1.5 align-middle ${getSeverityChipClassName(severity)}`}
      data-testid={`severity-chip-${severity}`}
    >
      {getSeverityLabel(severity)}
    </span>
  );
});
