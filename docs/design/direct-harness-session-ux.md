# Direct-Harness Session UX Overhaul — Design Doc

**Status:** READY FOR FINAL SIGN-OFF — open questions resolved, risks have detailed mitigation plans
**Owner:** planner
**Branch:** `feat/single-harness-workers`
**PR target:** #460
**Date:** 2026-05-02

---

## 1. User Vision (from chatroom)

### New Session

1. User clicks "New session" — button is **always clickable** (no harness-readiness gate).
2. User picks a harness type (e.g. "Opencode"). Today only `opencode-sdk` exists, but the picker is first-class.
3. Selecting a harness triggers a daemon call to introspect that harness's **capabilities** (available agents, available models, configurable params). The form populates with sane defaults.
4. User customizes agent + model + any other configurable params, types the **first message**, and submits. This single submit **creates the session and sends the first prompt**.

### Existing Session

1. Click an existing session → loads its **last-used params** (agent, model, etc.).
2. User can change the params **at any point mid-session** (each prompt re-uses the new params, but past prompts are unaffected).

### Implicit

- Multi-harness picker is first-class even though only one harness exists today.
- "Capabilities" is per harness _type_ (and per workspace, since each workspace's `opencode` config differs).

---

## 2. Current State (after PR #460 Phase B)

### Frontend

- `NewSessionButton.tsx`: button is **disabled** until `registry !== undefined && availableAgents.length > 0` (line 76, 104). Shows "Workspace harness is starting…" tooltip while gated.
- Hardcodes `harnessName: 'opencode-sdk'` (line 85). Hardcodes shape `{ workspaceId, harnessName, agent }` to `openSession` mutation.
- Pre-fetches agents from `getMachineRegistry` (chatroom-scoped) and dedupes per-workspace.
- Only lets the user pick `agent` (filtered to mode `primary`/`all`). No model picker, no per-prompt params, no first message.
- After session row is created, `onSessionCreated` switches the SessionDetail view; the user must then type into `SessionComposer` (line 73-81) to send a first prompt.
- `SessionComposer.tsx`: text-only `parts: [{type:'text', text}]` body. No model/agent override.
- `SessionDetail.tsx`: header shows `session.agent` as read-only text (line 46). No edit affordance.

### Backend (`services/backend/convex/chatroom/directHarness/`)

- `chatroom_harnessSessions` row stores: `workspaceId`, `harnessName`, `harnessSessionId?`, `agent: string`, `status`, `createdBy`, timestamps. **No `model`, no `params`, no `lastUsedConfig`.**
- `openSession` (sessions.ts:31): inserts row with `status: 'pending'`, returns `harnessSessionRowId`. Validates workspace exists + chatroom membership.
- `updateSessionAgent` (sessions.ts:152): patches `agent` only. Validates against `chatroom_machineRegistry` (forgiving when registry not yet published).
- `submitPrompt` (prompts.ts:25): only accepts `parts`. **No agent/model/system override at the prompt level.**
- `chatroom_machineRegistry` (schema.ts:2191): per-machine snapshot. `workspaces[].agents[]` is `{name, mode, model?, description?}`. **Has agent list, but no model registry, no provider list.**
- `capabilities.publishMachineCapabilities`: upsert-only, called from daemon on boot.

### Daemon / harness layer

- `createBoundOpencodeSdkHarness` (`packages/cli/src/infrastructure/harnesses/opencode-sdk/index.ts:243`): exposes `openSession({config:{agent}})`, `resumeSession`, and `listAgents()` on the process handle.
- `OpenSessionOptions.config` (currently typed) supports `agent`, `chatroomId`, `role`, `machineId`. The agent is **stored in metadata only** — not actually passed to the SDK.
- The opencode SDK `session.create` body **only accepts `parentID` + `title`** (verified in `node_modules/.../sdk/dist/gen/types.gen.d.ts:1808`). Agent/model/system/tools are passed **per-prompt** via `session.promptAsync`'s body (line 2326-2340: `messageID?`, `model?{providerID,modelID}`, `agent?`, `noReply?`, `system?`, `tools?{[k]:boolean}`, `parts`).
- The current `OpencodeSdkDirectHarnessSession.prompt()` (`session.ts:66-72`) **hardcodes** `body: { parts }` and ignores any config. The agent the user picked is effectively discarded after the row is created.

### Critical insight

**The session-level "agent" we store is currently a label only.** The SDK applies agent/model/system/tools per-prompt. Today the picked agent never reaches opencode. That's a latent bug independent of this overhaul, and it shapes the design below.

---

## 3. Gap Analysis (per flow)

### New Session

| Want                                         | Have                                  | Gap                                                                                                          |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Always-clickable button                      | Disabled until registry+agents arrive | Remove gating; defer capability fetch into the form.                                                         |
| Harness-type picker                          | Hardcoded `'opencode-sdk'`            | Need a registry of available harness types (per workspace) + UI selector.                                    |
| Daemon capability call on harness select     | One pre-published snapshot only       | Need on-demand capability fetch (or richer always-published snapshot).                                       |
| Model + tools + system editable              | Only agent                            | Backend stores neither; UI shows neither.                                                                    |
| Submit creates session + sends first message | Two-step (create row, then composer)  | Need atomic "create session + enqueue first prompt" or a UI/backend flow that chains them deterministically. |
| Defaults populated from harness              | Agents listed flat with no defaults   | Need per-agent defaults (already on the agent: `agent.model`); need to honor them.                           |

### Existing Session

| Want                                      | Have                                     | Gap                                                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Click → load last-used params             | Loads `session.agent` only (label)       | Schema has no model/params; need `lastUsedConfig` field.                                                                                                                                   |
| Change params mid-session                 | `updateSessionAgent` exists (label only) | Need `updateSessionConfig` covering model + system + tools + agent; also need `submitPrompt` to honor per-prompt overrides (and persist the chosen overrides as the new `lastUsedConfig`). |
| Per-prompt params actually reach opencode | `prompt()` hardcodes `body:{parts}`      | Plumb `agent`, `model`, `system`, `tools` through `submitPrompt` → `chatroom_pendingPrompts` → daemon → `session.promptAsync`.                                                             |

---

## 4. Proposed Data Model Changes

> Nothing direct-harness has been released. We change the schema in place — no back-compat fields, no wrapper mutations, no backfill steps.

### 4.1 `chatroom_harnessSessions` — replace `agent` with `lastUsedConfig`

```ts
chatroom_harnessSessions: defineTable({
  // … existing fields, minus the old top-level `agent: v.string()` …
  lastUsedConfig: v.object({
    agent: v.string(),
    model: v.optional(v.object({ providerID: v.string(), modelID: v.string() })),
    system: v.optional(v.string()),
    tools: v.optional(v.record(v.string(), v.boolean())),
  }),
});
```

The top-level `agent` field is removed. `lastUsedConfig` is required at insert time (the new-session form always supplies at least `agent`). All reads/writes that touched `session.agent` move to `session.lastUsedConfig.agent`.

### 4.2 `chatroom_machineRegistry` — replace `agents[]` with `harnesses[]`

The current snapshot publishes agents with their _default_ model only. To let the user pick a different model, we need the **available models per provider** the harness can see. We also need to address harnesses as first-class so the picker is real.

```ts
chatroom_machineRegistry: defineTable({
  // … existing …
  workspaces: v.array(v.object({
    workspaceId: v.string(),
    cwd: v.string(),
    name: v.string(),
    harnesses: v.array(v.object({
      name: v.string(),                     // 'opencode-sdk'
      displayName: v.string(),              // 'Opencode'
      agents: v.array(v.object({
        name: v.string(),
        mode: v.union(...),
        model: v.optional(...),             // default model
        description: v.optional(v.string()),
      })),
      providers: v.array(v.object({
        providerID: v.string(),
        name: v.string(),
        models: v.array(v.object({
          modelID: v.string(),
          name: v.string(),
        })),
      })),
      // Free-form capability blob for harness-specific configurable params
      configSchema: v.optional(v.any()),    // future: JSON schema for tools/system
    })),
  })),
})
```

The flat workspace-level `agents[]` field is removed. UI reads agents from `workspaces[].harnesses[].agents[]` only.

### 4.3 `chatroom_pendingPrompts` — add per-prompt overrides (required)

```ts
chatroom_pendingPrompts: defineTable({
  // … existing …
  override: v.object({
    agent: v.string(),
    model: v.optional(v.object({ providerID: v.string(), modelID: v.string() })),
    system: v.optional(v.string()),
    tools: v.optional(v.record(v.string(), v.boolean())),
  }),
});
```

`override` is **required** (per Decision §8.3). The frontend always supplies the full per-prompt config; the daemon does not silently fall back to `lastUsedConfig`. `agent` is required inside `override`; `model`/`system`/`tools` remain optional because the SDK applies sensible defaults for those when omitted.

---

## 5. Backend API Surface

### 5.1 New / changed mutations + queries

| Endpoint                                      | Type                                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `directHarness.capabilities.listForWorkspace` | query                                    | Returns `harnesses[]` (with agents + providers + models) for a workspace. UI calls this when the new-session form opens, after a harness is selected.                                                                                                                                                                                                                                                                    |
| `directHarness.capabilities.requestRefresh`   | mutation                                 | Inserts a `chatroom_pendingPrompts` row with `taskType: 'refreshCapabilities'` (new task type) so the daemon can re-introspect on demand. Returns immediately; UI subscribes to the registry query for live updates.                                                                                                                                                                                                     |
| `directHarness.sessions.openSession`          | mutation (extended, atomic)              | Required `config: {agent, model?, system?, tools?}` and required `firstPrompt: {parts}`. Atomically inserts the `chatroom_harnessSessions` row **and** a paired `chatroom_pendingPrompts` row (taskType `'prompt'`, with `override` populated from `config`). Returns `{harnessSessionRowId, promptId}`. Validation order: prompt payload validated first so a bad prompt rejects before any row is inserted (see §9.5). |
| `directHarness.sessions.updateSessionConfig`  | mutation (replaces `updateSessionAgent`) | Patches `lastUsedConfig` (any subset). Validates agent + model against the registry (forgiving when registry not yet published, same convention as today). The old `updateSessionAgent` is removed outright — webapp moves to the new mutation in the same change.                                                                                                                                                       |
| `directHarness.prompts.submitPrompt`          | mutation (extended)                      | Adds **required** `override: {agent, model?, system?, tools?}`. The frontend always sends the full override (per Decision §8.3). The mutation also patches `harnessSession.lastUsedConfig` so the session-detail popover stays in sync with what was last sent.                                                                                                                                                          |

### 5.2 Daemon / harness changes

- **Add a new `taskType: 'refreshCapabilities'`** to `chatroom_pendingPrompts` (or a separate small queue table) so the daemon can be asked to re-publish capability snapshots on demand.
- **Plumb `override` through to `session.promptAsync`** in `OpencodeSdkDirectHarnessSession.prompt()` — fixes the latent bug where the picked agent never reaches opencode.
- **Capability publisher upgrade**: `MachineCapabilities` snapshot must include providers/models. Get them from `client.config.providers()` (verify in SDK; fallback: hardcode known opencode providers + each agent's default model).
- **Multi-harness registry on the daemon**: introduce a `HarnessTypeRegistry` (in-memory map in the daemon process) that lists known harness implementations. Today it's `[{name:'opencode-sdk', displayName:'Opencode'}]`. The capability publisher loops over this list per workspace.

---

## 6. Frontend Surface

### 6.1 `NewSessionButton` → `NewSessionForm` (rewrite)

States:

- **Step 0 — closed**: button always enabled. No tooltip gating.
- **Step 1 — pick harness**: small list of harness types from `harnesses[]` for this workspace (or, if registry empty, show all known harness types with "loading capabilities…" placeholder).
- **Step 2 — configure** (after harness picked):
  - Trigger `requestRefresh` mutation in the background.
  - Show **agent picker** (defaults to first `primary`/`all` agent).
  - Show **model picker** (defaults to picked agent's `model`, falls back to provider's first model).
  - Show **first-message textarea** (required).
  - Optional collapsed "Advanced" panel: `system` text, tool toggles.
  - Submit → calls extended `openSession({workspaceId, harnessName, config, firstPrompt})`.
- **Step 3 — opening**: spinner; on success, switch view to the new session.

Empty-state strategy: form opens **even if registry is undefined**. If still empty after ~1s of waiting, show "harness still booting — defaults shown" and let the user submit anyway (server-side validation is forgiving when registry missing).

### 6.2 `SessionDetail` — params editor

- Header gets a small "Settings" affordance (gear / "Agent: builder · Sonnet · ⌄"). Clicking opens a popover with the same agent/model/advanced controls, sourced from registry.
- "Apply" patches `lastUsedConfig` via `updateSessionConfig`. New params take effect from the **next prompt** onward.
- Optional per-message override: a small `…` next to the Send button to override params for _this prompt only_ (advanced; v2).

### 6.3 `SessionComposer`

- Default behavior unchanged (no override → uses session's `lastUsedConfig`).
- Once `SessionDetail` exposes per-prompt override, pass it through `submitPrompt({override})`.

---

## 7. Phased Implementation Slicing

Each phase is independently shippable + testable. Because nothing direct-harness is released, schema changes are made in place — no back-compat fields, no backfill steps.

### Phase 1 — backend foundation

- Replace `agent: v.string()` on `chatroom_harnessSessions` with required `lastUsedConfig` (per §4.1). Update all reads/writes to use `lastUsedConfig.agent`.
- Add **required** `override` to `chatroom_pendingPrompts` (per §4.3).
- Extend `submitPrompt` to take required `override`. Extend `openSession` to take required `config` + `firstPrompt` and atomically insert both rows (per §5 and §9.5).
- Replace `updateSessionAgent` with `updateSessionConfig` (no wrapper).
- Tests: schema, mutation behavior, `lastUsedConfig` round-trips, atomic openSession (success returns both IDs; bad firstPrompt rejects before any insert).

### Phase 2 — daemon/harness plumbing (fix latent bug)

- Plumb `override` from `chatroom_pendingPrompts` → `harness.prompt()` → `session.promptAsync` body (in `packages/cli/src/infrastructure/harnesses/opencode-sdk/session.ts:66-72`). The daemon throws if `override.agent` is missing — no silent fallback (per §9.1).
- After prompt enqueued, `submitPrompt` patches `lastUsedConfig` so the UI popover stays in sync.
- Tests: integration test that an `agent` override actually appears in the SDK call body (mock `session.promptAsync`, assert `body.agent === 'builder'`).

### Phase 3 — capability snapshot upgrade

- Replace flat `workspaces[].agents[]` on `chatroom_machineRegistry` with `workspaces[].harnesses[]` (per §4.2).
- Capability publisher (`packages/cli/src/commands/machine/daemon-start/capabilities-sync.ts`) emits the new shape; `publishMachineCapabilities` validates the new shape only.
- Add `listProviders()` (or extend `listAgents()`) on the bound harness to call `client.config.providers()` (verified at `node_modules/.../sdk/dist/gen/types.gen.d.ts:2553-2572`). Project to minimal `{providerID, modelID, name}` shape per §9.2.
- Add `directHarness.capabilities.listForWorkspace` query.
- Tests: snapshot shape, dedupe across machines (per §9.4), payload-size safeguard (<256 KB for 5×100 models).

### Phase 4 — frontend rewrite

- Replace `NewSessionButton` with `NewSessionForm` (form-based, always-enabled, harness picker + agent/model + first-message).
- Add session-detail params popover wired to `updateSessionConfig`.
- Hook session-composer override path (or defer to Phase 5).
- Tests: form rendering, validation, submit flow, registry-empty fallback.

### Phase 5 — refresh + refinement

- `requestRefresh` mutation + `taskType:'refreshCapabilities'`.
- Optional per-prompt override in composer.

Phases 1+2 are highest value alone (they fix the latent bug). Phases 3+4 deliver the user's vision. Phase 5 is polish.

---

## 8. Decisions (resolved)

User-confirmed answers to the previously-open questions, with the resulting design implications baked in.

1. **Provider/model source — confirmed available.** The opencode SDK does expose what we need: `client.config.providers()` hits `GET /config/providers` and returns `{ providers: Array<Provider>, default: { [providerID]: modelID } }` (verified in `node_modules/.pnpm/@opencode-ai+sdk@1.14.22/.../sdk/dist/gen/types.gen.d.ts:2553-2572`). Each `Provider` exposes `id`, `name`, `source`, `env`, and `models: { [modelID]: Model }` (line 1335-1347). The daemon will use `client.config.providers()` as the canonical model source per workspace; the `default` map gives us a sane initial model per provider when an agent doesn't pin one. Phase 3 implementation: extend `OpencodeSdkDirectHarnessSession.listAgents()` (or add a sibling `listProviders()`) on the bound harness, and surface it through `MachineCapabilities.workspaces[].harnesses[].providers[]`.
2. **First-message-on-open atomicity — atomic.** `openSession` will, in a single Convex mutation, insert the `chatroom_harnessSessions` row **and** insert a paired `chatroom_pendingPrompts` row carrying the first prompt parts + the chosen `override`. Returns `{harnessSessionRowId, promptId}`. This eliminates the "row exists but no prompt" race and removes the need for the UI to chain two calls.
3. **Per-prompt override — frontend always resubmits.** The frontend always sends the full `override` (agent + model + system + tools) on every `submitPrompt` call, sourced from the session-detail params popover. The daemon does **not** silently fall back to `lastUsedConfig`; it requires `override` on every prompt. `lastUsedConfig` becomes a pure UI-state cache (the popover hydrates from it on session open) and a denormalization for session lists. This simplifies the daemon contract and makes "what params actually ran" auditable per prompt.
4. **Harness picker styling — always-visible dropdown/select.** The new-session form always shows a harness `<Select>` populated from `harnesses[]`, even when only `opencode-sdk` exists. No conditional hiding.
5. **Refresh affordance — explicit button.** The new-session form (and the session-detail params popover) both expose a "Refresh capabilities" button that fires `directHarness.capabilities.requestRefresh`. The daemon services the request via the new `taskType: 'refreshCapabilities'` queue entry and re-publishes the snapshot.

### Implementation deltas vs. earlier draft

- §5 `submitPrompt`: `override` is **required**, not optional. (Was optional in earlier draft.)
- §5 `openSession`: `firstPrompt` is **required** (atomic create-and-prompt). The mutation always inserts the paired pending-prompt row.
- §4.3 `chatroom_pendingPrompts.override`: now **required** (not optional). Schema reflects that the daemon contract demands a full per-prompt config.
- §6 `NewSessionForm`: harness `<Select>` always rendered. Refresh button shown alongside the form's first row.

---

## 9. Risks & Mitigation Plans

Each risk has been researched against the actual code; mitigations are concrete (file-level where possible).

### 9.1 Latent bug fix changes per-prompt behavior

**Risk.** Today `OpencodeSdkDirectHarnessSession.prompt()` (`packages/cli/src/infrastructure/harnesses/opencode-sdk/session.ts:66-72`) hardcodes `body: { parts }` and discards any agent/model the caller selected. Opencode falls back to its server-side default agent/model. After Phase 2, prompts will actually use the picked agent + model — which may differ from what local sessions have been silently running.

**Mitigation.**

- **Fail-loud on missing override** (per Decision §8.3): the daemon's `prompt()` call will throw if `override.agent` is missing, surfacing any caller that forgot to send it during the cutover. No silent server-side fallback.
- **Integration test** in `packages/cli/src/commands/machine/daemon-start/` (sibling to `pending-prompt-subscription-gap.test.ts`) that asserts the SDK call body contains the override fields. Mock the opencode client and assert `session.promptAsync` was called with `body.agent === 'builder'` and `body.model === { providerID, modelID }`.
- **PR note**: explicitly call out the behavior change in PR #460's description so reviewers know any local opencode session created post-merge will run with the picked agent (not the server default).

### 9.2 Capability snapshot bloat

**Risk.** Publishing every provider × every model on every `publishMachineCapabilities` call grows the `chatroom_machineRegistry` row. Convex documents are capped (~1 MB); a workspace with many providers (anthropic, openai, openrouter, etc.) and many models could approach that.

**Research.** The `Provider.models` map from `client.config.providers()` returns the full `Model` type (`types.gen.d.ts:1278`) including capability flags and API metadata. We do **not** need any of that on the registry — the UI only needs `{providerID, modelID, name}` to render a picker.

**Mitigation.**

- **Project to a minimal shape** in the daemon publisher before sending: `{providerID, modelID, name}` per model (drop `cost`, `limit`, `capabilities`, `options`, `headers`, etc.). Estimated <100 bytes per model. A workspace with 5 providers × 50 models each = ~25 KB — well under Convex limits.
- **Deduplicate at publish time**: if multiple machines publish the same workspace, the existing dedupe in `MachineCapabilitiesCache` (`packages/cli/src/commands/machine/daemon-start/capabilities-sync.ts`) handles it; extend the cache key to cover `harnesses[].providers[]` so we don't redundantly republish identical model lists.
- **Schema-level safeguard**: add a unit test that asserts `MachineCapabilities` payloads serialize to <256 KB for a representative workspace (5 providers × 100 models). Place under `packages/cli/src/commands/machine/daemon-start/capabilities-sync.test.ts`.
- **Future escape hatch (not implemented in v1)**: if a workspace exceeds the limit, the daemon can split the snapshot per harness or store models in a separate `chatroom_machineProviderModels` table keyed by `(machineId, workspaceId, harnessName, providerID)`.

### 9.3 Form usability when registry empty

**Risk.** First launch of the daemon: the new-session form opens before `publishMachineCapabilities` has fired. Today, `NewSessionButton.tsx:76` solves this by gating the button. Per the user vision, the button is now always clickable, so the form must degrade gracefully.

**Research.** The current `openSession` mutation (`services/backend/convex/chatroom/directHarness/sessions.ts:31`) already validates workspace membership but does **not** require the agent to be in the registry — `updateSessionAgent` is "forgiving when registry not yet published" per the existing code comment. We can preserve that behavior in `updateSessionConfig`.

**Mitigation.**

- **Optimistic form rendering**: when `harnesses[]` is empty for a workspace, the form renders a single hardcoded harness option (`{name: 'opencode-sdk', displayName: 'Opencode'}`) plus a free-text agent field with a default of `'build'` (the opencode SDK default). The user can submit immediately.
- **Auto-refresh on open**: opening the form fires `requestRefresh` immediately (in addition to the explicit button). If the registry populates within ~500 ms, the form upgrades the dropdowns in place using a controlled `defaultValue` pattern (so the user's typing isn't lost).
- **Inline status banner**: when `harnesses[]` is empty, show a non-blocking banner: "Capabilities still loading — defaults shown. Click Refresh to retry." Avoids the appearance of a broken form.
- **Backend forgiveness**: `updateSessionConfig` keeps the "validates against registry, but allows submission when registry empty" pattern from today's `updateSessionAgent`. `openSession` does the same for `firstPrompt.override`.

### 9.4 Multi-machine workspaces — divergent capability snapshots

**Risk.** Two machines (e.g., laptop + desktop) both publish capabilities for the same workspace path. Their `opencode` configs may differ (different providers configured, different agents available, different default models). The webapp currently dedupes agents per-workspace (`NewSessionButton.tsx:53-70`); we need a defensible merge strategy for harnesses, providers, and models.

**Research.** `chatroom_machineRegistry` is keyed by `machineId` — one row per machine. The dedupe today happens **client-side** in `NewSessionButton` by collecting `workspaces[].agents[]` across all registry rows for the chatroom and `Set`-ing by name. Models will need the same treatment but with a richer key.

**Mitigation.**

- **Merge by stable key, union semantics**: client-side helper in webapp (probably `apps/webapp/src/modules/chatroom/directHarness/utils/mergeCapabilities.ts`) that:
  - Merges `harnesses[]` by `harness.name` (union — show every harness any machine reports).
  - Within each harness, merges `agents[]` by `agent.name` (union; if defaults differ, take the first machine's value but record divergence in a `_divergent` debug field).
  - Within each harness, merges `providers[]` by `provider.providerID` (union), and `provider.models[]` by `(providerID, modelID)` (union).
- **Transparency in UI**: when a model is only available on one of multiple machines, the picker shows it but with a small "(only on `<machine-name>`)" badge so the user knows running this prompt may end up on a specific machine. The harness-routing logic doesn't change in v1 — pending prompts are routed by workspace, not by model availability — so picking a "only on machine X" model could fail if the prompt routes to machine Y. Document this as a known limitation.
- **Test**: unit test in webapp covering the merge for: (a) two machines, identical capabilities; (b) two machines, disjoint providers; (c) two machines, overlapping models with different defaults.
- **Future hardening (not in v1)**: route pending prompts to the machine whose capability snapshot includes the chosen model, falling back to "any machine" when ambiguous.

### 9.5 New: atomic openSession transaction failure modes

(Added because Decision §8.2 makes openSession atomic.)

**Risk.** `openSession` now inserts two rows in one mutation (`chatroom_harnessSessions` + `chatroom_pendingPrompts`). If the second insert fails, Convex rolls back the first — but the UI must distinguish "session created successfully" from "session+prompt both failed."

**Mitigation.**

- **Single-mutation Convex semantics give us the atomicity for free**: Convex mutations are transactional, so partial state is impossible.
- **Return both IDs on success**: the mutation returns `{harnessSessionRowId, promptId}`. The UI awaits both before switching to the SessionDetail view.
- **Validation order**: validate the prompt payload (parts non-empty, override.agent present) **before** the session insert so a malformed prompt doesn't even create the session row.
- **Test**: backend unit test that asserts (a) successful path returns both IDs and both rows exist; (b) malformed `firstPrompt` rejects before either row is inserted.

### 9.6 New: required `override` on every prompt — frontend regression risk

(Added because Decision §8.3 requires the override on every `submitPrompt`.)

**Risk.** A future code path that calls `submitPrompt` without populating `override` (e.g., a retry button, an automation, a stale callsite) will be rejected by the daemon. This is intentional (per §9.1) but can manifest as user-visible errors if missed.

**Mitigation.**

- **Type-level enforcement**: make `override` non-optional in the Convex validator and the TypeScript signature. Any caller missing the field fails typecheck.
- **Single source of truth in webapp**: route every `submitPrompt` call through one hook (`useSubmitPrompt(harnessSessionRowId)`) that pulls `override` from the session-detail Zustand store (or the equivalent state container). No raw mutation calls from components.
- **Test**: webapp unit test that asserts `useSubmitPrompt` always passes `override` and pulls from the session store.

---

## 10. Out of Scope

- Auth/permission changes (existing chatroom-membership model is sufficient).
- Conversation forking (parentID is exposed by SDK but not requested).
- Custom tools UI beyond simple boolean toggles.
- Streaming model output changes (already handled by message stream sink).

---

**Next step**: get final user sign-off on §4 (data model), §7 (phasing), §8 (decisions), and §9 (mitigations), then delegate Phase 1 to builder.
