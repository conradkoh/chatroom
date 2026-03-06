'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useState, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// ─── Color palette for model bars ───────────────────────────────────────────

const MODEL_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

function getModelColor(index: number): string {
  return MODEL_COLORS[index % MODEL_COLORS.length];
}

// ─── Types ───────────────────────────────────────────────────────────────────

type ScopeMode = 'workspace' | 'chatroom' | 'machine';

interface AgentRestartChartProps {
  machineId: string;
  workingDir: string;
  chatroomId: string;
  roles: string[];
}

// ─── Underline tab classes ────────────────────────────────────────────────────

const TAB_BASE = 'text-[11px] font-bold uppercase tracking-wide pb-0.5 transition-colors';
const TAB_ACTIVE = 'border-b-2 border-chatroom-accent text-chatroom-text-primary';
const TAB_INACTIVE =
  'border-b-2 border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary';

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentRestartChart({
  machineId,
  workingDir,
  chatroomId,
  roles,
}: AgentRestartChartProps) {
  const [scopeMode, setScopeMode] = useState<ScopeMode>('workspace');
  const [selectedRole, setSelectedRole] = useState<string>(roles[0] ?? '');

  const data = useSessionQuery(
    api.machines.getAgentRestartMetrics,
    selectedRole
      ? {
          machineId,
          role: selectedRole,
          workingDir: scopeMode === 'workspace' ? workingDir : undefined,
          chatroomId:
            scopeMode === 'chatroom' ? (chatroomId as Id<'chatroom_rooms'>) : undefined,
          hoursBack: 24,
        }
      : 'skip'
  );

  // Transform data into recharts format
  const { chartData, modelKeys } = useMemo(() => {
    if (!data || data.length === 0) return { chartData: [], modelKeys: [] };

    // Collect all unique model keys
    const modelSet = new Set<string>();
    for (const { byModel } of data) {
      for (const key of Object.keys(byModel)) {
        modelSet.add(key);
      }
    }
    const modelKeys = Array.from(modelSet);

    const chartData = data.map(({ hourBucket, byModel }) => ({
      hour: new Date(hourBucket).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
      ...byModel,
    }));

    return { chartData, modelKeys };
  }, [data]);

  const isEmpty = !data || data.length === 0;

  return (
    <div className="mt-2 space-y-1.5">
      {/* Section label */}
      <div className="text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted">
        Restarts / 24h
      </div>

      {/* Unified tab row: scope tabs + optional role tabs */}
      <div className="flex items-center gap-3">
        {/* Scope tabs */}
        {(['workspace', 'chatroom', 'machine'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setScopeMode(mode)}
            className={`${TAB_BASE} ${scopeMode === mode ? TAB_ACTIVE : TAB_INACTIVE}`}
          >
            {mode === 'workspace' ? 'WS' : mode === 'chatroom' ? 'CR' : 'ALL'}
          </button>
        ))}

        {/* Divider + role tabs (only when multiple roles) */}
        {roles.length > 1 && (
          <>
            <span className="h-3 w-px bg-chatroom-border flex-shrink-0" />
            {roles.map((role) => (
              <button
                key={role}
                onClick={() => setSelectedRole(role)}
                className={`${TAB_BASE} ${selectedRole === role ? TAB_ACTIVE : TAB_INACTIVE}`}
              >
                {role}
              </button>
            ))}
          </>
        )}
      </div>

      {/* Chart area */}
      {isEmpty ? (
        <div className="h-[100px] flex items-center justify-center">
          <p className="text-[10px] text-chatroom-text-muted">No restart data in the last 24h</p>
        </div>
      ) : (
        <div className="h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 2, right: 4, left: -24, bottom: 0 }}>
              <XAxis
                dataKey="hour"
                tick={{ fontSize: 8, fill: 'var(--chatroom-text-muted, currentColor)' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 8, fill: 'var(--chatroom-text-muted, currentColor)' }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: '4px',
                  fontSize: '10px',
                }}
                labelStyle={{ fontWeight: 'bold', marginBottom: '2px' }}
                cursor={{ fill: 'rgba(128,128,128,0.1)' }}
              />
              {modelKeys.map((model, idx) => (
                <Bar
                  key={model}
                  dataKey={model}
                  stackId="a"
                  fill={getModelColor(idx)}
                  radius={idx === modelKeys.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Model legend */}
      {!isEmpty && modelKeys.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          {modelKeys.map((model, idx) => (
            <div key={model} className="flex items-center gap-1">
              <div
                className="w-2 h-2 rounded-sm flex-shrink-0"
                style={{ backgroundColor: getModelColor(idx) }}
              />
              <span className="text-[9px] text-chatroom-text-muted truncate max-w-[120px]" title={model}>
                {model.split('/').pop() ?? model}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
