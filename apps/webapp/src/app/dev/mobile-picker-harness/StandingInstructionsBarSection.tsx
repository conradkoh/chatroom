'use client';

import { BookOpen } from 'lucide-react';
import { useState } from 'react';

import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';
import {
  PickerOptionRow,
  PickerPanelHeader,
  PickerScrollBody,
  ResponsivePickerShell,
  getMobileDrawerContentStyle,
  MOBILE_DRAWER_CONTENT_CLASSNAME,
} from '@/modules/chatroom/components/picker';
import { useOverlayPortalContainer } from '@/modules/chatroom/components/shared/overlayPortalContainer';

export function StandingInstructionsBarSection() {
  const isDesktop = useIsDesktop();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState('Always use TypeScript');
  const [lastAction, setLastAction] = useState<string | null>(null);

  const actionRowClassName = isDesktop ? undefined : 'min-h-11 py-3 text-sm';
  const barMinH = isDesktop ? 'min-h-9' : 'min-h-11';
  const labelText = isDesktop ? 'text-[10px]' : 'text-xs';
  const iconSize = isDesktop ? 12 : 14;

  const keyboardInsetPx = useVisualViewportKeyboardInset(editOpen && !isDesktop);
  const portalContainer = useOverlayPortalContainer();

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider">Standing instructions bar</h2>
      <p className="text-[10px] text-chatroom-text-muted">
        Actions: ResponsivePickerShell. Mobile edit: drawer with large Confirm/Cancel.
      </p>
      <ResponsivePickerShell
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title="Standing instructions"
        align="start"
        contentClassName="w-56 p-0"
        trigger={
          <button
            type="button"
            data-testid="open-standing-instructions-bar"
            className={`${barMinH} px-3 py-1.5 border border-chatroom-status-success/15 bg-chatroom-status-success/5 flex items-center gap-2 w-full text-left`}
          >
            <BookOpen size={iconSize} className="shrink-0 text-chatroom-status-success" />
            <span
              className={`${labelText} font-bold uppercase tracking-wider text-chatroom-status-success`}
            >
              Standing instructions
            </span>
            <span className="text-xs text-chatroom-text-secondary truncate flex-1">
              Always use TypeScript
            </span>
          </button>
        }
      >
        <PickerPanelHeader title="Standing instructions" />
        <PickerScrollBody>
          <PickerOptionRow
            selected={false}
            className={actionRowClassName}
            onSelect={() => {
              setLastAction('edit');
              setActionsOpen(false);
              if (!isDesktop) setEditOpen(true);
            }}
          >
            Edit
          </PickerOptionRow>
          <PickerOptionRow
            selected={false}
            className={actionRowClassName}
            onSelect={() => {
              setLastAction('disable');
              setActionsOpen(false);
            }}
          >
            Disable
          </PickerOptionRow>
          <PickerOptionRow
            selected={false}
            className={actionRowClassName}
            onSelect={() => {
              setLastAction('delete');
              setActionsOpen(false);
            }}
          >
            <span className="text-destructive">Delete</span>
          </PickerOptionRow>
        </PickerScrollBody>
      </ResponsivePickerShell>

      {!isDesktop ? (
        <Drawer
          open={editOpen}
          onOpenChange={setEditOpen}
          nested
          repositionInputs={false}
          handleOnly
          container={portalContainer ?? undefined}
        >
          <DrawerContent
            className={MOBILE_DRAWER_CONTENT_CLASSNAME}
            style={getMobileDrawerContentStyle(keyboardInsetPx)}
          >
            <DrawerHeader className="p-0 shrink-0">
              <DrawerTitle className="sr-only">Edit standing instructions</DrawerTitle>
            </DrawerHeader>
            <PickerPanelHeader title="Edit standing instructions" />
            <div className="flex flex-col gap-3 p-3">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Enter standing instructions…"
                rows={5}
                className="w-full min-h-[120px] bg-chatroom-bg-primary border border-chatroom-border px-3 py-3 text-sm text-chatroom-text-primary placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent resize-none"
              />
              <div className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 bg-chatroom-accent text-chatroom-text-on-accent"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 text-chatroom-text-muted border border-chatroom-border"
                >
                  Cancel
                </button>
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}

      {lastAction ? (
        <div data-testid="standing-instructions-last-action" className="text-[10px]">
          {lastAction}
        </div>
      ) : null}
    </section>
  );
}
