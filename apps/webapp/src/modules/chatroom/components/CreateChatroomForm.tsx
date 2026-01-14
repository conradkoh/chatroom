'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import { useMutation } from 'convex/react';
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
  const createChatroom = useMutation(chatroomApi.chatrooms.create);

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
    <div className="create-form">
      <div className="create-form-header">
        <h2>Create New Chatroom</h2>
        <p>Select a team configuration for your chatroom</p>
      </div>

      <div className="create-form-body">
        <div className="form-field">
          <label className="form-label">Team</label>
          <select
            className="form-select"
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

        {selectedTeamData && (
          <div className="team-preview">
            <div className="team-preview-description">{selectedTeamData.description}</div>
            <div className="team-preview-roles">
              {selectedTeamData.roles.map((role) => (
                <span key={role} className="team-preview-role">
                  {role}
                </span>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="create-form-error">
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="create-form-actions">
        <button className="cancel-button" onClick={onCancel} disabled={creating}>
          Cancel
        </button>
        <button
          className="create-button"
          onClick={handleCreate}
          disabled={creating || !selectedTeam}
        >
          {creating ? 'Creating...' : 'Create Chatroom'}
        </button>
      </div>
    </div>
  );
}
