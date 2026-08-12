type Props = {
  sources: string[];
  value?: string;
  onChange: (source: string | undefined) => void;
  disabled?: boolean;
};
export function LogSourceSelect({ sources, value, onChange, disabled }: Props) {
  return (
    <select
      className="border border-chatroom-border bg-chatroom-bg-secondary px-2 py-1.5 text-xs text-chatroom-text-primary disabled:opacity-50"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || undefined)}
      aria-label="Filter by log source"
    >
      <option value="">All sources</option>
      {sources.map((item) => (
        <option key={item} value={item}>
          {item}
        </option>
      ))}
    </select>
  );
}
