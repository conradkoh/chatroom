import type { ModelGroup } from './types';
import { filterPickerItems } from '../../components/picker';

export function filterModelGroups(
  groups: ModelGroup[],
  searchTerm: string,
  options?: { isHidden?: (value: string) => boolean }
): ModelGroup[] {
  return groups
    .map((group) => {
      const visibleOptions = options?.isHidden
        ? group.options.filter((o) => !options.isHidden?.(o.value))
        : group.options;
      const searched = filterPickerItems(
        visibleOptions,
        searchTerm,
        (option) => `${group.providerLabel} ${group.providerKey} ${option.label} ${option.value}`
      );
      return { ...group, options: searched };
    })
    .filter((group) => group.options.length > 0);
}
