'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import React, { useState, useCallback } from 'react';

interface TeamDefinition {
  name: string;
  description: string;
  roles: string[];
  entryPoint?: string;
}

interface TeamsConfig {
  defaultTeam: string;
  teams: Record<string, TeamDefinition>;
}

interface CreateChatroomFormProps {
  onCreated: (chatroomId: string) => void;
  onCancel: () => void;
}

// Default teams configuration (matching the CLI defaults)
const DEFAULT_TEAMS_CONFIG: TeamsConfig = {
  defaultTeam: 'pair',
  teams: {
    pair: {
      name: 'Pair',
      description: 'A builder and reviewer working together',
      roles: ['builder', 'reviewer'],
      entryPoint: 'builder',
    },
    squad: {
      name: 'Squad',
      description: 'Full team with manager, architects, builders, and reviewers',
      roles: ['manager', 'architect', 'builder', 'frontend-designer', 'reviewer', 'tester'],
      entryPoint: 'manager',
    },
  },
};

export function CreateChatroomForm({ onCreated, onCancel }: CreateChatroomFormProps) {
  const [config] = useState<TeamsConfig>(DEFAULT_TEAMS_CONFIG);
  const [selectedTeam, setSelectedTeam] = useState<string>(DEFAULT_TEAMS_CONFIG.defaultTeam);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Type assertion workaround for Convex API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chatroomApi = api as any;
  const createChatroom = useSessionMutation(chatroomApi.chatrooms.create);

  const handleCreate = useCallback(async () => {
    if (!selectedTeam) return;

    const team = config.teams[selectedTeam];
    if (!team) return;

    setCreating(true);
    setError(null);

    try {
      const chatroomId = await createChatroom({
        teamId: selectedTeam,
        teamName: team.name,
        teamRoles: team.roles,
        teamEntryPoint: team.entryPoint || team.roles[0],
      });

      onCreated(chatroomId);
    } catch (err) {
      const e = err as Error;
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }, [selectedTeam, config.teams, createChatroom, onCreated]);

  const selectedTeamData = config.teams[selectedTeam];

  return (
    <div className="bg-chatroom-bg-surface backdrop-blur-xl border-2 border-chatroom-border-strong w-full max-w-md mx-auto">
      {/* Header */}
      <div className="p-6 border-b-2 border-chatroom-border">
        <h2 className="text-sm font-bold uppercase tracking-widest text-chatroom-text-primary m-0">
          Create New Chatroom
        </h2>
        <p className="text-chatroom-text-muted text-xs mt-2 m-0">
          Select a team configuration for your chatroom
        </p>
      </div>

      {/* Body */}
      <div className="p-6 flex flex-col gap-4">
        {/* Form Field */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-bold uppercase tracking-widest text-chatroom-text-muted">
            Team
          </label>
          <select
            className="bg-chatroom-bg-primary border-2 border-chatroom-border text-chatroom-text-primary p-3 text-sm focus:outline-none focus:border-chatroom-border-strong"
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
          >
            {Object.entries(config.teams).map(([id, team]) => (
              <option key={id} value={id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        {/* Team Preview */}
        {selectedTeamData && (
          <div className="bg-chatroom-bg-tertiary p-4 border-l-2 border-chatroom-border-strong">
            <div className="text-chatroom-text-secondary text-sm mb-3">
              {selectedTeamData.description}
            </div>
            <div className="flex flex-wrap gap-2">
              {selectedTeamData.roles.map((role) => (
                <span
                  key={role}
                  className="bg-chatroom-bg-hover px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-chatroom-text-muted"
                >
                  {role}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-400/10 text-chatroom-status-error p-3 text-xs">
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-6 border-t-2 border-chatroom-border flex justify-end gap-3">
        <button
          className="bg-transparent border-2 border-chatroom-border text-chatroom-text-secondary px-4 py-2 text-xs font-bold uppercase tracking-wide cursor-pointer transition-all duration-100 hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong hover:text-chatroom-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onCancel}
          disabled={creating}
        >
          Cancel
        </button>
        <button
          className="bg-chatroom-accent text-chatroom-bg-primary border-0 px-4 py-2 text-xs font-bold uppercase tracking-wide cursor-pointer transition-all duration-100 hover:bg-chatroom-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleCreate}
          disabled={creating || !selectedTeam}
        >
          {creating ? 'Creating...' : 'Create Chatroom'}
        </button>
      </div>
    </div>
  );
}
