'use client';

import { memo } from 'react';

import type { HandoffSeverity } from '../../utils/handoffSeverity';
import { getSeverityChipClassNames, getSeverityLabel } from '../../utils/handoffSeverity';

export const SeverityChip = memo(function SeverityChip({
  severity,
}: {
  severity: HandoffSeverity;
}) {
  return (
    <span className={getSeverityChipClassNames(severity)} data-testid={`severity-chip-${severity}`}>
      {getSeverityLabel(severity)}
    </span>
  );
});
