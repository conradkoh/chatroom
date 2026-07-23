'use client';

import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { CAPABILITIES_REFRESH_HINT } from './select-empty-states';
import {
  ResponsivePickerShell,
  PickerSearch,
  PickerScrollBody,
  PickerOptionRow,
  usePickerSearchState,
  filterPickerItems,
} from '../../../components/picker';
import {
  pickerTriggerClassName,
  pickerTriggerChevronClassName,
  PICKER_TRIGGER_CHEVRON_SIZE,
} from '../../../components/picker/pickerTriggerStyles';
import { getHarnessDisplayName } from '../../../types/machine';
import type { HarnessOption } from '../../hooks/useHarnessConfig';

function harnessOptionLabel(h: HarnessOption): string {
  return getHarnessDisplayName(h.name);
}

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
  const [open, setOpen] = useState(false);
  const { searchTerm, setSearchTerm, handleOpenChange } = usePickerSearchState(setOpen);
  const hasHarnesses = harnesses.length > 0;
  const isDisabled = !hasHarnesses || disabled;

  const selectedHarness = useMemo(
    () => harnesses.find((h) => h.name === value),
    [harnesses, value]
  );
  const triggerLabel = hasHarnesses
    ? selectedHarness
      ? harnessOptionLabel(selectedHarness)
      : 'Harness...'
    : 'No harnesses available';

  const filteredHarnesses = filterPickerItems(
    harnesses,
    searchTerm,
    (h) => `${harnessOptionLabel(h)} ${h.name}`
  );

  return (
    <ResponsivePickerShell
      open={open}
      onOpenChange={handleOpenChange}
      disabled={isDisabled}
      title="Select harness"
      align="start"
      contentClassName="w-72"
      trigger={
        <button
          type="button"
          disabled={isDisabled}
          className={pickerTriggerClassName}
          title={hasHarnesses ? 'Select harness' : CAPABILITIES_REFRESH_HINT}
          aria-label={hasHarnesses ? 'Select harness' : 'No harnesses available'}
        >
          <span className="truncate flex items-center min-w-0">{triggerLabel}</span>
          <ChevronDown
            size={PICKER_TRIGGER_CHEVRON_SIZE}
            className={pickerTriggerChevronClassName}
          />
        </button>
      }
    >
      <PickerSearch value={searchTerm} onChange={setSearchTerm} placeholder="Search harnesses…" />
      <PickerScrollBody maxHeightClassName="max-h-60">
        {filteredHarnesses.length === 0 ? (
          <p className="px-3 py-2 text-xs text-chatroom-text-muted">No harnesses found.</p>
        ) : (
          filteredHarnesses.map((h) => (
            <PickerOptionRow
              key={h.name}
              selected={value === h.name}
              onSelect={() => {
                onValueChange(h.name);
                handleOpenChange(false);
              }}
            >
              {harnessOptionLabel(h)}
            </PickerOptionRow>
          ))
        )}
      </PickerScrollBody>
    </ResponsivePickerShell>
  );
}
