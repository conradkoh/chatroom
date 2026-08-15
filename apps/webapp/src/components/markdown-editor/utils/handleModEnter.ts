export function isModEnterKey(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>) {
  return (event.metaKey || event.ctrlKey) && event.key === 'Enter';
}

export function handleModEnter(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>, onCmdEnter?: () => void): boolean {
  if (!onCmdEnter || !isModEnterKey(event)) return false;
  onCmdEnter();
  return true;
}
