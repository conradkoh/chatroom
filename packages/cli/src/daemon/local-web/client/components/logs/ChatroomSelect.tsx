import type { ChatroomListItem } from '@/api/types';
import { SearchableSelect } from '@/components/picker';

type Props = {
  chatrooms: ChatroomListItem[];
  value?: string | undefined;
  onChange: (id: string) => void;
  disabled?: boolean | undefined;
  isLoading?: boolean | undefined;
  isError?: boolean | undefined;
};
export function ChatroomSelect({
  chatrooms,
  value,
  onChange,
  disabled,
  isLoading,
  isError,
}: Props) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-chatroom-text-muted">Chatroom</span>
      <SearchableSelect
        options={chatrooms.map((c) => ({ value: c.id, label: c.displayName }))}
        value={value}
        onChange={(id) => {
          if (id) onChange(id);
        }}
        disabled={disabled}
        isLoading={isLoading}
        isError={isError}
        placeholder="Select chatroom"
        allowClear={false}
        searchPlaceholder="Search chatrooms…"
        ariaLabel="Filter by chatroom"
        triggerClassName="min-w-[10rem]"
      />
    </label>
  );
}
