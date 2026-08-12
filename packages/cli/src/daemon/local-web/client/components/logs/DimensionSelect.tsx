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
      <select
        className="border border-chatroom-border bg-chatroom-bg-secondary px-2 py-1.5 text-xs text-chatroom-text-primary disabled:opacity-50"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || undefined)}
        aria-label={label}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
