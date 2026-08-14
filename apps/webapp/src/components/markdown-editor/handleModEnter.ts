import { isModEnterKey } from '@/modules/chatroom/utils/isModEnterKey';

export function handleModEnter(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>, onCmdEnter?: () => void): boolean {
  if (!onCmdEnter || !isModEnterKey(event)) return false;
  onCmdEnter();
  return true;
}
