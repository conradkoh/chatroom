'use client';

import { useEffect, useMemo, useState } from 'react';

import { FilterPickerSection, FlatPickerSection } from './HarnessPickerSections';
import { KeyboardInsetSlider } from './KeyboardInsetSlider';
import { useHarnessDrawerMetrics } from './useHarnessDrawerMetrics';

const MODELS = Array.from(
  { length: 24 },
  (_, i) => `provider/model-${String(i + 1).padStart(2, '0')}`
);

export function MobilePickerHarness() {
  const [flatOpen, setFlatOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [flatSearch, setFlatSearch] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [activeElementDesc, setActiveElementDesc] = useState('(none)');
  useEffect(() => {
    const update = () => {
      const el = document.activeElement;
      if (!el || el === document.body) {
        setActiveElementDesc('(none)');
        return;
      }
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const placeholder = (el as HTMLInputElement).placeholder
        ? `[placeholder="${(el as HTMLInputElement).placeholder}"]`
        : '';
      setActiveElementDesc(`${tag}${id}${placeholder}`);
    };
    document.addEventListener('focusin', update);
    update();
    return () => document.removeEventListener('focusin', update);
  }, []);

  const metrics = useHarnessDrawerMetrics(
    flatOpen,
    filterOpen,
    keyboardInset,
    flatSearch,
    filterSearch
  );

  const filteredModels = useMemo(() => {
    const term = flatSearch.trim().toLowerCase();
    if (!term) return MODELS;
    return MODELS.filter((m) => m.toLowerCase().includes(term));
  }, [flatSearch]);

  return (
    <div className="chatroom-root min-h-dvh bg-chatroom-bg-primary text-chatroom-text-primary p-4 space-y-6">
      <header className="space-y-1">
        <h1 className="text-sm font-bold uppercase tracking-wider">Mobile Picker Harness</h1>
        <p className="text-xs text-chatroom-text-muted">
          Dev-only page for validating drawer safe areas and keyboard scroll (PR #963).
        </p>
      </header>

      <KeyboardInsetSlider value={keyboardInset} onChange={setKeyboardInset} />

      <FlatPickerSection
        open={flatOpen}
        onOpenChange={setFlatOpen}
        search={flatSearch}
        onSearchChange={setFlatSearch}
        models={filteredModels}
      />

      <FilterPickerSection
        open={filterOpen}
        onOpenChange={setFilterOpen}
        search={filterSearch}
        onSearchChange={setFilterSearch}
      />

      <div className="text-[10px] bg-chatroom-bg-tertiary border border-chatroom-border p-2">
        <span className="font-semibold">Focus: </span>
        <span data-testid="focus-indicator">{activeElementDesc}</span>
      </div>

      <pre
        data-testid="drawer-metrics"
        className="text-[10px] bg-chatroom-bg-tertiary border border-chatroom-border p-2 overflow-x-auto"
      >
        {metrics ? JSON.stringify(metrics, null, 2) : 'Open a picker to see drawer metrics'}
      </pre>
    </div>
  );
}
