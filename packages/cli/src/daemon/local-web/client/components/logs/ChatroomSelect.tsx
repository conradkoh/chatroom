import type { ChatroomListItem } from '@/api/types';

type Props = {
  chatrooms: ChatroomListItem[];
  value?: string;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
  isLoading?: boolean;
};
export function ChatroomSelect({ chatrooms, value, onChange, disabled, isLoading }: Props) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-chatroom-text-muted">Chatroom</span>
      <select
        className="max-w-[14rem] border border-chatroom-border bg-chatroom-bg-secondary px-2 py-1.5 text-xs text-chatroom-text-primary disabled:opacity-50"
        value={value ?? ''}
        disabled={disabled || isLoading}
        onChange={(e) => onChange(e.target.value || undefined)}
        aria-label="Filter by chatroom"
        aria-busy={isLoading}
      >
        <option value="">{isLoading ? 'Loading…' : 'All chatrooms'}</option>
        {chatrooms.map((c) => (
          <option key={c.id} value={c.id}>
            {c.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
