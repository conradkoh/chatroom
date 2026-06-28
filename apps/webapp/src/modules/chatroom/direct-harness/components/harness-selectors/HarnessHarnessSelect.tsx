'use client';

import { CAPABILITIES_REFRESH_HINT, PENDING_SELECT_VALUE } from './select-empty-states';
import type { HarnessOption } from '../../hooks/useHarnessConfig';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

interface HarnessHarnessSelectProps {
  harnesses: HarnessOption[];
  value: string;
  onValueChange: (name: string) => void;
  /** When true, the dropdown is visible but disabled (frozen harness mode). */
  disabled?: boolean;
}

export function HarnessHarnessSelect({
  harnesses,
  value,
  onValueChange,
  disabled,
}: HarnessHarnessSelectProps) {
  const hasHarnesses = harnesses.length > 0;

  if (!hasHarnesses) {
    return (
      <Select value={PENDING_SELECT_VALUE} disabled>
        <SelectTrigger
          size="sm"
          className="text-xs w-full bg-transparent"
          title={CAPABILITIES_REFRESH_HINT}
        >
          <SelectValue placeholder="No harnesses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            value={PENDING_SELECT_VALUE}
            disabled
            className="text-xs text-muted-foreground"
          >
            No harnesses available
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      {/* bg-transparent overrides dark:bg-input/30 from base SelectTrigger for visual consistency with HarnessModelSelect */}
      <SelectTrigger size="sm" className="text-xs w-full bg-transparent">
        <SelectValue placeholder="Harness" />
      </SelectTrigger>
      <SelectContent>
        {harnesses.map((h) => (
          <SelectItem key={h.name} value={h.name} className="text-xs">
            {h.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
