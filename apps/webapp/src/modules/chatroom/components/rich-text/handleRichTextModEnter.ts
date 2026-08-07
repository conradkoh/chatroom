import { isModEnterKey } from '../../utils/isModEnterKey';

export function handleRichTextModEnter(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>,
  onCmdEnter?: () => void
): boolean {
  if (!onCmdEnter || !isModEnterKey(event)) return false;
  onCmdEnter();
  return true;
}
