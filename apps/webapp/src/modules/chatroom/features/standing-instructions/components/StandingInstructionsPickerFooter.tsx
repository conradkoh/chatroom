'use client';

// fallow-ignore-next-line complexity
export function StandingInstructionsPickerFooter({
  isActive,
  hasContent,
  selectedId,
  activeId,
  onDisable,
  onEnable,
  onApply,
  mobile,
}: {
  isActive: boolean;
  hasContent: boolean;
  selectedId: string | null;
  activeId: string | null;
  onDisable: () => void;
  onEnable: () => void;
  onApply: () => void;
  mobile?: boolean;
}) {
  const showUpdate = isActive && selectedId !== null && selectedId !== activeId;
  const showApply = !isActive && selectedId !== null;
  const showDisable = isActive;
  const showEnable = !isActive && hasContent && selectedId === null;

  const primaryLabel = isActive ? 'Update' : 'Apply';
  const primaryDisabled = !showUpdate && !showApply;

  const primaryBtnClass = mobile
    ? 'min-h-11 text-sm font-bold uppercase tracking-wider px-4 py-3 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed'
    : 'text-xs font-bold uppercase tracking-wider px-2 py-0.5 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';

  const secondaryBtnClass = mobile
    ? 'min-h-11 text-sm font-bold uppercase tracking-wider px-4 py-3 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors border border-chatroom-border'
    : 'text-xs font-bold uppercase tracking-wider px-2 py-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors';

  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-chatroom-border shrink-0">
      <div>
        {showDisable ? (
          <button type="button" onClick={onDisable} className={secondaryBtnClass}>
            Disable
          </button>
        ) : null}
        {showEnable ? (
          <button type="button" onClick={onEnable} className={secondaryBtnClass}>
            Enable
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onApply}
        disabled={primaryDisabled}
        className={primaryBtnClass}
      >
        {primaryLabel}
      </button>
    </div>
  );
}
