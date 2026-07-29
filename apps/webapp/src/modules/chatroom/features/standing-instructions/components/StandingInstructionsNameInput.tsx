'use client';

export interface StandingInstructionsNameInputProps {
  value: string;
  onChange: (value: string) => void;
  mobile?: boolean;
}

export function StandingInstructionsNameInput({
  value,
  onChange,
  mobile,
}: StandingInstructionsNameInputProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Name (optional)"
      maxLength={120}
      className={`w-full bg-chatroom-bg-primary border border-chatroom-border placeholder:text-chatroom-text-muted focus:outline-none focus:border-chatroom-accent ${
        mobile ? 'px-3 py-2 text-sm' : 'px-2 py-1 text-xs'
      }`}
    />
  );
}
