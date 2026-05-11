'use client';

import { HarnessHarnessSelect } from './HarnessHarnessSelect';
import { HarnessAgentSelect } from './HarnessAgentSelect';
import { HarnessModelSelect } from './HarnessModelSelect';
import { HarnessFilterButton } from './HarnessFilterButton';
import type { HarnessOption, UseHarnessConfigResult } from '../../hooks/useHarnessConfig';
import type { UseHarnessModelFilterResult } from '../../hooks/useHarnessModelFilter';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HarnessSelectorBarProps {
  // Harness selector
  harnesses: HarnessOption[];
  harnessName: string;
  onHarnessChange: (name: string) => void;
  /**
   * When true, the harness dropdown is rendered but disabled — for in-session
   * use where the harness can't change mid-session.
   */
  harnessFrozen?: boolean;

  // Agent + model state (parent-owned via useHarnessConfig)
  config: UseHarnessConfigResult;

  /**
   * Optional model filter. When omitted OR when `filter.enabled === false`,
   * the filter button is not rendered.
   */
  filter?: UseHarnessModelFilterResult;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * HarnessSelectorBar — the four controls in a single consistent row:
 *   [ Harness ▾ ] [ Agent ▾ ] [ Model ▾              ] [ ⚙ filter ]
 *
 * All four controls share identical visual language: h-8, text-xs, border
 * border-input, bg-transparent, sharp corners (from ui/select.tsx override),
 * ChevronDown at size=12.
 *
 * Reusable from both NewSessionComposer (creation) and SessionComposer
 * (in-session) via the `harnessFrozen` prop.
 */
export function HarnessSelectorBar({
  harnesses,
  harnessName,
  onHarnessChange,
  harnessFrozen,
  config,
  filter,
}: HarnessSelectorBarProps) {
  const {
    selectedAgent,
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    providers,
    resolvedAgent,
  } = config;

  const selectedHarness = harnesses.find((h) => h.name === harnessName) ?? harnesses[0];
  const currentHarnessAgents = selectedHarness?.agents ?? [];

  const showFilter = filter && filter.enabled;

  return (
    <div className="flex gap-2">
      {/* Harness selector — fixed narrow width */}
      <div className="w-32 shrink-0">
        <HarnessHarnessSelect
          harnesses={harnesses}
          value={harnessName}
          onValueChange={onHarnessChange}
          disabled={harnessFrozen}
        />
      </div>

      {/* Agent selector — fixed narrow width */}
      <div className="w-28 shrink-0">
        <HarnessAgentSelect
          agents={currentHarnessAgents}
          value={selectedAgent}
          onValueChange={setSelectedAgent}
          resolvedAgent={resolvedAgent}
        />
      </div>

      {/* Model selector — flex to fill remaining space */}
      <div className="flex-1 min-w-0">
        <HarnessModelSelect
          providers={providers}
          value={selectedModel}
          onValueChange={setSelectedModel}
          isHidden={filter?.isHidden}
        />
      </div>

      {/* Filter button — only shown when filter is enabled */}
      {showFilter && (
        <HarnessFilterButton filter={filter} providers={providers} />
      )}
    </div>
  );
}
