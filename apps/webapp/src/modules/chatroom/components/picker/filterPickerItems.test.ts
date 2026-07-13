import { describe, it, expect } from 'vitest';

import { filterPickerItems } from './filterPickerItems';

interface Item {
  id: string;
  label: string;
}

const items: readonly Item[] = [
  { id: '1', label: 'Apple' },
  { id: '2', label: 'Banana' },
  { id: '3', label: 'Cherry' },
];

describe('filterPickerItems', () => {
  it('returns all items when search term is empty', () => {
    const result = filterPickerItems(items, '', (item) => item.label);
    expect(result).toEqual([...items]);
  });

  it('returns all items when search term is whitespace only', () => {
    const result = filterPickerItems(items, '   ', (item) => item.label);
    expect(result).toEqual([...items]);
  });

  it('filters case-insensitively', () => {
    const result = filterPickerItems(items, 'apple', (item) => item.label);
    expect(result).toEqual([{ id: '1', label: 'Apple' }]);
  });

  it('filters with lowercase term against mixed-case labels', () => {
    const result = filterPickerItems(items, 'bAnAnA', (item) => item.label);
    expect(result).toEqual([{ id: '2', label: 'Banana' }]);
  });

  it('returns empty array when no items match', () => {
    const result = filterPickerItems(items, 'zebra', (item) => item.label);
    expect(result).toEqual([]);
  });

  it('works with custom getSearchText returning different values', () => {
    const result = filterPickerItems(items, '2', (item) => item.id);
    expect(result).toEqual([{ id: '2', label: 'Banana' }]);
  });

  it('does not mutate the original array', () => {
    const original = [...items];
    filterPickerItems(items, 'apple', (item) => item.label);
    expect(items).toEqual(original);
  });
});
