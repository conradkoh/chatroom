'use client';

import { PickerPanelHeader, PickerScrollBody, PickerOptionRow } from '../../../components/picker';

export interface StandingInstructionsActionsViewProps {
  isActive: boolean;
  onEdit: () => void;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  mobile?: boolean;
}

export function StandingInstructionsActionsView({
  isActive,
  onEdit,
  onEnable,
  onDisable,
  onDelete,
  mobile,
}: StandingInstructionsActionsViewProps) {
  const rowClassName = mobile ? 'min-h-11 py-3 text-sm' : undefined;

  return (
    <>
      <PickerPanelHeader title="Standing instructions" />
      <PickerScrollBody>
        <PickerOptionRow onSelect={onEdit} className={rowClassName}>
          Edit
        </PickerOptionRow>
        {isActive ? (
          <PickerOptionRow onSelect={onDisable} className={rowClassName}>
            Disable
          </PickerOptionRow>
        ) : (
          <PickerOptionRow onSelect={onEnable} className={rowClassName}>
            Enable
          </PickerOptionRow>
        )}
        <PickerOptionRow onSelect={onDelete} className={rowClassName}>
          <span className="text-destructive">Remove from chat</span>
        </PickerOptionRow>
      </PickerScrollBody>
    </>
  );
}
