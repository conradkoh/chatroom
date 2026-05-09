'use client';

/**
 * HarnessSelectorRow — the three-selector row (harness / agent / model) plus
 * the per-machine model filter button.
 *
 * Extracted so the same row can be reused from both:
 * - NewSessionComposer (session creation, filter button active)
 * - SessionComposer (in-session, to be wired later when agent/model switching ships)
 *
 * The row is layout-only: all state lives in the parent via the `config` and
 * `filter` props, which keeps the component stateless and trivially reusable.
 */

import { SlidersHorizontal } from 'lucide-react';
import { useMemo, useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { HarnessAgentSelect, HarnessModelSelect } from './HarnessSelects';
import type { HarnessOption, UseHarnessConfigResult } from '../hooks/useHarnessConfig';
import type { UseHarnessModelFilterResult } from '../hooks/useHarnessModelFilter';
import { ModelFilterPanel } from '../../components/ModelFilterPanel';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface HarnessSelectorRowProps {
  harnesses: HarnessOption[];
  harnessName: string;
  onHarnessChange: (name: string) => void;
  config: UseHarnessConfigResult;
  filter: UseHarnessModelFilterResult;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function HarnessSelectorRow({
  harnesses,
  harnessName,
  onHarnessChange,
  config,
  filter,
}: HarnessSelectorRowProps) {
  const { selectedAgent, setSelectedAgent, selectedModel, setSelectedModel, providers } = config;

  const [filterOpen, setFilterOpen] = useState(false);

  // Build availableModels in "providerID/modelID" format for ModelFilterPanel
  const availableModels = useMemo(
    () =>
      providers.flatMap((p) =>
        p.models.map((m) => `${p.providerID}/${m.modelID}`)
      ),
    [providers]
  );

  // Pass the full agents array — HarnessAgentSelect filters mode primary|all internally
  const selectedHarness = harnesses.find((h) => h.name === harnessName) ?? harnesses[0];
  const currentHarnessAgents = selectedHarness?.agents ?? [];

  return (
    <div className="flex gap-2">
      {/* Harness selector */}
      <Select value={harnessName} onValueChange={onHarnessChange}>
        <SelectTrigger className="h-8 py-0 text-xs w-32 shrink-0">
          <SelectValue placeholder="Harness" />
        </SelectTrigger>
        <SelectContent>
          {harnesses.length > 0 ? (
            harnesses.map((h) => (
              <SelectItem key={h.name} value={h.name} className="text-xs">
                {h.displayName}
              </SelectItem>
            ))
          ) : (
            <SelectItem value="opencode-sdk" className="text-xs">
              Opencode
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      {/* Agent selector */}
      <div className="w-28 shrink-0">
        <HarnessAgentSelect
          agents={currentHarnessAgents}
          value={selectedAgent}
          onValueChange={setSelectedAgent}
        />
      </div>

      {/* Model selector — grouped by provider, searchable */}
      <div className="flex-1 min-w-0 flex flex-col">
        <HarnessModelSelect
          providers={providers}
          value={selectedModel}
          onValueChange={setSelectedModel}
        />
      </div>

      {/* Model filter button — only shown when filter persistence is available */}
      {filter.enabled && (
        <ModelFilterPanel
          open={filterOpen}
          onOpenChange={setFilterOpen}
          trigger={
            <button
              type="button"
              onClick={() => setFilterOpen((v) => !v)}
              className="shrink-0 h-8 w-8 flex items-center justify-center border border-border bg-background hover:border-foreground/30 text-muted-foreground hover:text-foreground transition-colors"
              title="Configure visible models"
              aria-label="Configure visible models"
            >
              <SlidersHorizontal size={12} />
            </button>
          }
          availableModels={availableModels}
          filter={filter.filter ?? null}
          onFilterChange={(hiddenModels, hiddenProviders) =>
            void filter.setFilter(hiddenModels, hiddenProviders)
          }
        />
      )}
    </div>
  );
}
