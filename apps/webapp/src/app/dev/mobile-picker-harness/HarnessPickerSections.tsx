'use client';

import {
  PickerOptionRow,
  PickerPanelHeader,
  PickerScrollBody,
  PickerSearch,
  ResponsivePickerShell,
} from '@/modules/chatroom/components/picker';

const MODELS = Array.from(
  { length: 24 },
  (_, i) => `provider/model-${String(i + 1).padStart(2, '0')}`
);

type FlatPickerSectionProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
  models: string[];
};

export function FlatPickerSection({
  open,
  onOpenChange,
  search,
  onSearchChange,
  models,
}: FlatPickerSectionProps) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider">Flat list picker</h2>
      <ResponsivePickerShell
        open={open}
        onOpenChange={onOpenChange}
        title="Select model"
        trigger={
          <button
            type="button"
            data-testid="open-flat-picker"
            className="w-full border px-3 py-2 text-xs"
          >
            Open model picker
          </button>
        }
      >
        <PickerSearch value={search} onChange={onSearchChange} placeholder="Search models…" />
        <PickerScrollBody>
          {models.map((model, index) => (
            <div
              key={model}
              {...(index === models.length - 1 ? { 'data-testid': 'picker-last-option' } : {})}
            >
              <PickerOptionRow selected={index === 0} onSelect={() => onOpenChange(false)}>
                {model}
              </PickerOptionRow>
            </div>
          ))}
        </PickerScrollBody>
      </ResponsivePickerShell>
    </section>
  );
}

type FilterPickerSectionProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  search: string;
  onSearchChange: (value: string) => void;
};

export function FilterPickerSection({
  open,
  onOpenChange,
  search,
  onSearchChange,
}: FilterPickerSectionProps) {
  const models = MODELS.filter((m) =>
    search.trim() ? m.toLowerCase().includes(search.toLowerCase()) : true
  );

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider">Filter panel picker</h2>
      <ResponsivePickerShell
        open={open}
        onOpenChange={onOpenChange}
        title="Model Visibility"
        trigger={
          <button
            type="button"
            data-testid="open-filter-picker"
            className="w-full border px-3 py-2 text-xs"
          >
            Open filter picker
          </button>
        }
      >
        <PickerPanelHeader title="Model Visibility" className="shrink-0" />
        <PickerSearch value={search} onChange={onSearchChange} placeholder="Search models..." />
        <PickerScrollBody maxHeightClassName="max-h-[576px]">
          {models.map((model, index) => (
            <div
              key={model}
              {...(index === models.length - 1 ? { 'data-testid': 'picker-last-option' } : {})}
            >
              <PickerOptionRow onSelect={() => onOpenChange(false)}>{model}</PickerOptionRow>
            </div>
          ))}
        </PickerScrollBody>
        <button type="button" className="w-full shrink-0 border-t px-3 py-2 text-xs">
          Reset All
        </button>
      </ResponsivePickerShell>
    </section>
  );
}
