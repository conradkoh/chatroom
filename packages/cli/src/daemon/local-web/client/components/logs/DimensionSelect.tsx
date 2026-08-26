import { SearchableSelect } from '@/components/picker';

type Props = {
  label: string;
  options: string[];
  value?: string;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
  allLabel?: string;
};
export function DimensionSelect({
  label,
  options,
  value,
  onChange,
  disabled,
  allLabel = 'All',
}: Props) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-chatroom-text-muted">{label}</span>
      <SearchableSelect
        options={options.map((o) => ({ value: o, label: o }))}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={allLabel}
        allLabel={allLabel}
        searchPlaceholder={`Search ${label.toLowerCase()}…`}
        ariaLabel={label}
      />
    </label>
  );
}
