'use client';

import { NativeIntegrationBadge } from '../../../components/NativeIntegrationBadge';
import { SessionResumeBadge } from '../../../components/SessionResumeBadge';
import {
  harnessSupportsNativeIntegration,
  harnessSupportsSessionResume,
} from '../../../types/machine';
import type { AgentHarness } from '../../../types/machine';
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
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      {/* bg-transparent overrides dark:bg-input/30 from base SelectTrigger for visual consistency with HarnessModelSelect */}
      <SelectTrigger className="h-8 text-xs w-full bg-transparent">
        <SelectValue placeholder="Harness" />
      </SelectTrigger>
      <SelectContent>
        {harnesses.length > 0 ? (
          harnesses.map((h) => (
            <SelectItem key={h.name} value={h.name} className="text-xs">
              <span className="flex items-center min-w-0">
                {h.displayName}
                {harnessSupportsSessionResume(h.name as AgentHarness) && <SessionResumeBadge />}
                {harnessSupportsNativeIntegration(h.name as AgentHarness) && (
                  <NativeIntegrationBadge />
                )}
              </span>
            </SelectItem>
          ))
        ) : (
          <SelectItem value="opencode-sdk" className="text-xs">
            Opencode
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
