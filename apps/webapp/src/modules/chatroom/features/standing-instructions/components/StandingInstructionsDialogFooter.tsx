'use client';

export interface StandingInstructionsDialogFooterProps {
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  mobile?: boolean;
}

export function StandingInstructionsDialogFooter({
  onConfirm,
  onCancel,
  confirmDisabled,
  mobile,
}: StandingInstructionsDialogFooterProps) {
  const cancelClasses = mobile
    ? 'min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors border border-chatroom-border'
    : 'text-xs font-bold uppercase tracking-wider px-2 py-0.5 text-chatroom-text-muted hover:text-chatroom-text-primary transition-colors';

  const confirmClasses = mobile
    ? 'min-h-11 flex-1 text-sm font-bold uppercase tracking-wider px-4 py-3 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed'
    : 'text-xs font-bold uppercase tracking-wider px-2 py-0.5 bg-chatroom-accent text-chatroom-text-on-accent hover:opacity-80 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div
      data-testid="standing-instructions-dialog-footer"
      className={mobile ? 'flex items-stretch justify-between gap-2' : 'flex items-center gap-2'}
    >
      <button type="button" onClick={onCancel} className={cancelClasses}>
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={confirmDisabled}
        className={confirmClasses}
      >
        Confirm
      </button>
    </div>
  );
}
