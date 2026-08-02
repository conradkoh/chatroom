'use client';

import type { api } from '@workspace/backend/convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';

type PresetUsage = FunctionReturnType<typeof api.standingInstructions.getPresetUsage>;

/**
 * Shared body for the preset confirm dialogs: usage loading state, count
 * summary, and per-chatroom usage list. `variant` adjusts the copy.
 */
// fallow-ignore-next-line complexity
export function StandingInstructionsPresetUsageDetails({
  usage,
  variant,
}: {
  usage: PresetUsage | undefined;
  variant: 'edit' | 'delete';
}) {
  if (usage === undefined) return <p>Loading...</p>;

  const countLabel =
    usage.totalCount === 1
      ? 'This preset is used in 1 chatroom.'
      : `This preset is used in ${usage.totalCount} chatrooms.`;

  return (
    <>
      <p>
        {countLabel}
        {variant === 'edit'
          ? ` (${usage.activeCount} active, ${usage.inactiveCount} inactive). Editing will update all of them.`
          : ' Deleting it will remove standing instructions from all linked chatrooms.'}
      </p>
      {usage.usages.length > 0 && (
        <ul className="list-disc pl-4 text-sm">
          {usage.usages.map((u) => (
            <li key={u.chatroomId}>
              {u.title} ({u.enabled ? 'active' : 'inactive'})
            </li>
          ))}
        </ul>
      )}
      {variant === 'delete' ? <p className="text-destructive">This cannot be undone.</p> : null}
    </>
  );
}
