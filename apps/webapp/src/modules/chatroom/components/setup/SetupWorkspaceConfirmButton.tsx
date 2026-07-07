'use client';

interface SetupWorkspaceConfirmButtonProps {
  disabled: boolean;
  isConfirming: boolean;
  onConfirm: () => void;
}

export function SetupWorkspaceConfirmButton({
  disabled,
  isConfirming,
  onConfirm,
}: SetupWorkspaceConfirmButtonProps) {
  return (
    <div className="flex justify-end pt-2">
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="px-4 py-2 bg-chatroom-accent text-chatroom-bg-primary text-xs font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50"
      >
        {isConfirming ? 'Creating...' : 'Confirm Workspace'}
      </button>
    </div>
  );
}
