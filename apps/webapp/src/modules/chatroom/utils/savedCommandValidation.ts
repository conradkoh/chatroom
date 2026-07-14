import type { SavedCommandScope } from '../types/savedCommand';

export function checkDuplicateSavedCommandName(
  name: string,
  scope: SavedCommandScope,
  existingNamesByScope: Record<SavedCommandScope, string[]>,
  options?: { isEditMode?: boolean; initialName?: string; initialScope?: SavedCommandScope }
): string | null {
  const lowerName = name.toLowerCase();
  const scopeNames = existingNamesByScope[scope] ?? [];
  const namesToCheck =
    options?.isEditMode && options.initialScope === scope
      ? scopeNames.filter((n) => n.toLowerCase() !== (options.initialName ?? '').toLowerCase())
      : scopeNames;
  if (namesToCheck.some((n) => n.toLowerCase() === lowerName)) {
    return `A command named "${name}" already exists in this ${scope} scope.`;
  }
  return null;
}
