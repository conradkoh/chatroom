'use client';

import { MermaidBlock } from '@/modules/chatroom/components/MermaidBlock';

const SAMPLE_CHART = 'flowchart TD\n  U[User request] --> P[Planner]';

export function MermaidHarness() {
  return (
    <main data-testid="mermaid-harness" className="p-6">
      <h1 className="text-lg font-semibold mb-4">Mermaid Harness</h1>
      <MermaidBlock chart={SAMPLE_CHART} />
    </main>
  );
}
