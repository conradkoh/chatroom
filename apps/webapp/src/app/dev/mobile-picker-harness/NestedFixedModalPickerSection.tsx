'use client';

import { useState } from 'react';

import {
  FixedModal,
  FixedModalBody,
  FixedModalContent,
  FixedModalHeader,
  FixedModalTitle,
} from '@/components/ui/fixed-modal';
import {
  PickerOptionRow,
  PickerScrollBody,
  PickerSearch,
  ResponsivePickerShell,
} from '@/modules/chatroom/components/picker';

const ITEMS = ['OpenCode (SDK) v1.17.18', 'Claude Code', 'Cursor', 'Codex'];

export function NestedFixedModalPickerSection() {
  const [modalOpen, setModalOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const filtered = ITEMS.filter((i) =>
    search.trim() ? i.toLowerCase().includes(search.toLowerCase()) : true
  );

  return (
    <section className="space-y-2" data-testid="nested-fixed-modal-section">
      <h2 className="text-xs font-bold uppercase tracking-wider">
        Nested FixedModal picker (production nesting)
      </h2>
      <p className="text-[10px] text-chatroom-text-muted">
        Reproduces Agents panel: FixedModal FocusScope → ResponsivePickerShell portal.
      </p>
      <button
        type="button"
        data-testid="open-nested-modal"
        className="w-full border px-3 py-2 text-xs"
        onClick={() => setModalOpen(true)}
      >
        Open FixedModal
      </button>
      <FixedModal isOpen={modalOpen} onClose={() => setModalOpen(false)} maxWidth="max-w-lg">
        <FixedModalContent>
          <FixedModalHeader onClose={() => setModalOpen(false)}>
            <FixedModalTitle>Agents (harness)</FixedModalTitle>
          </FixedModalHeader>
          <FixedModalBody>
            <div className="p-4">
              <ResponsivePickerShell
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                title="Select harness"
                trigger={
                  <button
                    type="button"
                    data-testid="open-nested-picker"
                    className="w-full border px-3 py-2 text-xs truncate"
                  >
                    <span className="truncate">OpenCode (SDK) v1.17.18</span>
                  </button>
                }
              >
                <PickerSearch value={search} onChange={setSearch} placeholder="Search harnesses…" />
                <PickerScrollBody>
                  {filtered.map((item, index) => (
                    <PickerOptionRow
                      key={item}
                      selected={index === 0}
                      onSelect={() => setPickerOpen(false)}
                    >
                      {item}
                    </PickerOptionRow>
                  ))}
                </PickerScrollBody>
              </ResponsivePickerShell>
            </div>
          </FixedModalBody>
        </FixedModalContent>
      </FixedModal>
    </section>
  );
}
