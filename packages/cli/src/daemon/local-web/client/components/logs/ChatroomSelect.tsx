import type { ChatroomListItem } from '@/api/types';
import { SearchableSelect } from '@/components/picker';
type Props = {
  chatrooms: ChatroomListItem[];
  value?: string;
  onChange: (id: string | undefined) => void;
  disabled?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  allowAll?: boolean;
};
export function ChatroomSelect({
  chatrooms,
  value,
  onChange,
  disabled,
  isLoading,
  isError,
  allowAll = true,
}: Props) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-chatroom-text-muted">Chatroom</span>
      <SearchableSelect
        options={chatrooms.map((c) => ({ value: c.id, label: c.displayName }))}
        value={value}
        onChange={onChange}
        disabled={disabled}
        isLoading={isLoading}
        isError={isError}
        placeholder={allowAll ? 'All chatrooms' : 'Select chatroom'}
        allLabel={allowAll ? 'All chatrooms' : undefined}
        searchPlaceholder="Search chatrooms…"
        ariaLabel="Filter by chatroom"
        triggerClassName="min-w-[10rem]"
      />
    </label>
  );
}
