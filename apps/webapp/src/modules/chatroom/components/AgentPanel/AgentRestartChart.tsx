'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useState, useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from 'recharts';

// ─── Color palette for model bars ───────────────────────────────────────────

const MODEL_COLORS = [
  'var(--chatroom-status-info)',      // blue — adapts per mode
  'var(--chatroom-status-success)',   // green — adapts per mode
  'var(--chatroom-status-warning)',   // amber — adapts per mode
  'var(--chatroom-status-purple)',    // purple — adapts per mode
  'var(--chatroom-status-error)',     // red — adapts per mode
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const SHORT_MONTH = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatDayLabel(date: Date): string {
  return `${SHORT_MONTH[date.getMonth()]} ${date.getDate()}`;
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

interface CustomTooltipProps {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: Array<{ payload: any; value: number }>;
  label?: string;
}

function RestartTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const entry = payload[0];
  const total = entry?.value ?? 0;
  const byModel: Record<string, number> = entry?.payload?._byModel ?? {};
  const modelEntries = Object.entries(byModel).filter(([, count]) => count > 0);

  return (
    <div
      style={{
        backgroundColor: 'var(--chatroom-bg-primary)',
        border: '1px solid var(--chatroom-border-strong)',
        borderRadius: '0px',
        padding: '6px 8px',
      }}
    >
      <div
        style={{
          fontWeight: 'bold',
          fontSize: '9px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--chatroom-text-muted)',
          marginBottom: '4px',
        }}
      >
        {label}
      </div>
      {/* Per-model breakdown */}
      {modelEntries.map(([model, count], idx) => (
        <div
          key={model}
          style={{
            fontSize: '10px',
            color: 'var(--chatroom-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            marginBottom: '1px',
          }}
        >
          <div
            style={{
              width: '6px',
              height: '6px',
              backgroundColor: getModelColor(idx),
              borderRadius: '1px',
              flexShrink: 0,
            }}
          />
          <span style={{ flex: 1 }}>{model}</span>
          <span style={{ fontWeight: 600 }}>{count}</span>
        </div>
      ))}
      {/* Total row */}
      <div
        style={{
          borderTop: '1px solid var(--chatroom-border)',
          marginTop: '3px',
          paddingTop: '3px',
          fontSize: '10px',
          fontWeight: 'bold',
          color: 'var(--chatroom-text-primary)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Total</span>
        <span>{total}</span>
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentRestartChart({
  machineId,
  workingDir,
  chatroomId,
  roles,
}: AgentRestartChartProps) {
  const [scopeMode, setScopeMode] = useState<ScopeMode>('workspace');
  const [selectedRole, setSelectedRole] = useState<string>(roles[0] ?? '');
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    end: new Date(),
  });
  const [selectedPreset, setSelectedPreset] = useState<'7d' | '30d' | 'custom'>('7d');

  const handlePreset = useCallback((preset: '7d' | '30d') => {
    const days = preset === '7d' ? 7 : 30;
    const now = new Date();
    setDateRange({ start: new Date(now.getTime() - days * 24 * 60 * 60 * 1000), end: now });
    setSelectedPreset(preset);
  }, []);

  const handleStartChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = new Date(e.target.value + 'T00:00:00');
      if (!isNaN(parsed.getTime())) {
        setDateRange((prev) => ({ ...prev, start: parsed }));
        setSelectedPreset('custom');
      }
    },
    []
  );

  const handleEndChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = new Date(e.target.value + 'T23:59:59');
      if (!isNaN(parsed.getTime())) {
        setDateRange((prev) => ({ ...prev, end: parsed }));
        setSelectedPreset('custom');
      }
    },
    []
  );

  const data = useSessionQuery(
    api.machines.getAgentRestartMetrics,
    selectedRole
      ? {
          machineId,
          role: selectedRole,
          workingDir: scopeMode === 'workspace' ? workingDir : undefined,
          chatroomId:
            scopeMode === 'chatroom' ? (chatroomId as Id<'chatroom_rooms'>) : undefined,
          startTime: dateRange.start.getTime(),
          endTime: dateRange.end.getTime(),
        }
      : 'skip'
  );

  // Aggregate hourly rows into daily buckets
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const dayMap = new Map<string, { ts: number; byModel: Record<string, number> }>();

    for (const { hourBucket, byHarnessModel } of data) {
      const d = new Date(hourBucket);
      const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

      const existing = dayMap.get(dayKey);
      if (existing) {
        for (const [key, count] of Object.entries(byHarnessModel)) {
          existing.byModel[key] = (existing.byModel[key] ?? 0) + count;
        }
      } else {
        const startOfDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        dayMap.set(dayKey, { ts: startOfDay, byModel: { ...byHarnessModel } });
      }
    }

    return Array.from(dayMap.entries())
      .sort(([, a], [, b]) => a.ts - b.ts)
      .map(([, { ts, byModel }]) => {
        const total = Object.values(byModel).reduce((sum, n) => sum + n, 0);
        return {
          day: formatDayLabel(new Date(ts)),
          total,
          // Keep per-model data for tooltip detail
          _byModel: byModel,
        };
      });
  }, [data]);

  const isEmpty = !data || data.length === 0 || chartData.length === 0;

  return (
    <div className="mt-2 space-y-1.5">
      {/* Control row: presets + date inputs */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-chatroom-text-muted mr-1">
            Restarts
          </span>
          {(['7d', '30d'] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => handlePreset(preset)}
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded transition-colors ${
                selectedPreset === preset
                  ? 'bg-accent/50 text-accent-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent/30'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={formatDateInput(dateRange.start)}
            onChange={handleStartChange}
            className="bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] text-foreground rounded px-1 py-0.5"
          />
          <span className="text-[9px] text-muted-foreground">–</span>
          <input
            type="date"
            value={formatDateInput(dateRange.end)}
            onChange={handleEndChange}
            className="bg-chatroom-bg-tertiary border border-chatroom-border text-[10px] text-foreground rounded px-1 py-0.5"
          />
        </div>
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
            {mode === 'workspace' ? 'Workspace' : mode === 'chatroom' ? 'Room' : 'Machine'}
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
        <div className="h-[120px] flex items-center justify-center">
          <p className="text-[10px] text-chatroom-text-muted">No restart data in selected range</p>
        </div>
      ) : (
        <div className="h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 14, right: 4, left: -24, bottom: 0 }}>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 9, fill: 'var(--chatroom-text-muted)' }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 9, fill: 'var(--chatroom-text-muted)' }}
                tickLine={false}
                axisLine={false}
                width={32}
              />
              <Tooltip
                content={<RestartTooltip />}
                cursor={{ fill: 'var(--chatroom-bg-hover)', opacity: 0.4 }}
              />
              <Bar
                dataKey="total"
                fill="var(--chatroom-status-info)"
                radius={[2, 2, 0, 0]}
              >
                {/* Total count inside bar */}
                <LabelList
                  dataKey="total"
                  position="inside"
                  style={{
                    fontSize: '8px',
                    fontWeight: 'bold',
                    fill: 'var(--chatroom-bg-primary)',
                  }}
                  formatter={(value: unknown) => (Number(value) > 0 ? String(value) : '')}
                />
                {/* Total count above bar */}
                <LabelList
                  dataKey="total"
                  position="top"
                  style={{
                    fontSize: '8px',
                    fontWeight: 'bold',
                    fill: 'var(--chatroom-text-muted)',
                  }}
                  formatter={(value: unknown) => (Number(value) > 0 ? String(value) : '')}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

    </div>
  );
}
