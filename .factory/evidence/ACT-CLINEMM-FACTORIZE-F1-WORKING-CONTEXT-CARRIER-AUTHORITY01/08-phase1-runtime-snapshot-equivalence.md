# 08-phase1-runtime-snapshot-equivalence.md — seventy-sixth-pass bounded pre-RED discriminator

**ACT**: ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
**Phase**: bounded pre-RED discriminator — RUNTIME_SNAPSHOT_EQUIVALENCE
**Predecessor**: 07-phase1-return-shape-and-w-identity.md
  (`d4fd63ef1` retracted; `34997d1ff` honest `NOT_YET_BOUND`)
**Reviewer verdict (seventy-sixth pass)**:
  `HALT_RUNTIME_SNAPSHOT_DOES_NOT_CARRY_W_OPERANDS`
**Bounded scope**: read-only source inspection + 15-minute
search for an existing effective-runtime-config read seam.
NO production source touched. NO tests touched.

---

## Reviewer's frozen assertion — source verification

> "AgentRuntimeStateSnapshot does not carry systemPrompt or tools."

### Source anchors (frozen):

1. **`AgentRuntimeStateSnapshot` interface** —
   `sdk/packages/shared/src/agent.ts:273-363`:

   Fields present (every line of the interface body):
   - `agentId: string` (274)
   - `agentRole?: AgentRole` (275)
   - `parentAgentId?: string | null` (276)
   - `conversationId?: string` (277)
   - `runId?: string` (278)
   - `status: AgentRunStatus` (279)
   - `iteration: number` (280)
   - `messages: readonly AgentMessage[]` (281)
   - `pendingToolCalls: readonly string[]` (282)
   - `usage: AgentUsage` (283)
   - `lastError?: string` (284)
   - `lastErrorClass?: ProviderErrorClass` (286)
   - `recovery?: AgentRuntimeRecoverySnapshot` (309)
   - `execution?: AgentRuntimeExecutionState` (323)
   - `currentWorkingContextEstimate?: number` (362)

   **NO `systemPrompt`. NO `tools`. NO runtime tool registry.**
   **Interface closes at line 363.**

2. **`LocalRuntimeHost.getActiveRuntimeSnapshot(sessionId)`** —
   `sdk/packages/core/src/runtime/host/local-runtime-host.ts:1264`:

   ```typescript
   getActiveRuntimeSnapshot(sessionId: string | undefined): LiveAgentRuntimeStateSnapshot | undefined {
       if (!sessionId) return undefined
       const active = this.sessions.get(sessionId)
       if (!active) return undefined
       return active.agent.snapshot?.()
   }
   ```

   Forwards directly to `AgentRuntime.snapshot()` which returns
   the interface above.

3. **`ClineCore.runtimeSnapshot?(sessionId)` proxy** —
   `sdk/packages/core/src/ClineCore.ts:686-709`:

   Forwards to `LocalRuntimeHost.getActiveRuntimeSnapshot`.

4. **`SdkSessionHost.runtimeSnapshot?(sessionId)` interface**
   — `apps/vscode/src/sdk/session-host.ts:104`:

   ```typescript
   runtimeSnapshot?(sessionId: string | undefined): AgentRuntimeStateSnapshot | undefined
   ```

   Forwards from `ClineCore.runtimeSnapshot?(sessionId)`.

   **The return type is `AgentRuntimeStateSnapshot` — the type
   that has no `systemPrompt` / no `tools` field.**

5. **`RuntimeHost` interface contract** —
   `sdk/packages/core/src/runtime/host/runtime-host.ts:485`:

   ```typescript
   getActiveRuntimeSnapshot?(
       sessionId: string | undefined,
   ): import("@cline/shared").LiveAgentRuntimeStateSnapshot | undefined;
   ```

   Same frozen shape.

**The reviewer's assertion is FULLY CONFIRMED:**

```
RUNTIME_SNAPSHOT_HAS_SYSTEM_PROMPT = NO
RUNTIME_SNAPSHOT_HAS_TOOLS         = NO

OUTCOME_X_RUNTIME_SNAPSHOT_PATH    = REJECTED
```

The file-07 proposed Outcome X (route manual W through
`sdkHost.runtimeSnapshot?.`) is **structurally incompatible**
with the snapshot abstraction as currently defined. There is
NOTHING to read from the snapshot that would yield
`systemPrompt` or `tools` — those fields don't exist on
`AgentRuntimeStateSnapshot` at any point in the contract chain.

---

## Reviewer's secondary finding — "structural type lie" wording

The reviewer proposed softening "structural type lie" to
"RETURN-CONTRACT WIDENING / OPTIONAL-FIELD MISMATCH" because
TypeScript's structural typing permits an object lacking an
optional field to satisfy a type that declares that field as
optional.

**Accepted.** This is a semantic mismatch, not a TypeScript
type-system violation. The producer seam's declared return
type `ContextPipelinePrepareTurnResult` has
`currentWorkingContextEstimate?: number` (optional), and
TypeScript correctly accepts `CoreCompactionResult` (which
lacks the field entirely) as a valid instance. The defect is
**that the actual returned object is missing the field at
runtime**, not that the type system is unsound.

```
P2 wording update:
  "structural type lie"   ->  "RETURN-CONTRACT WIDENING /
                              OPTIONAL-FIELD MISMATCH"
  (semantic mismatch, not a TypeScript unsoundness)
```

---

## Bounded source search for existing effective-config seam

The reviewer mandated:

> "Find whether an existing coordinator/session/runtime API
> exposes the currently effective prompt and full current tool
> set without introducing any new state or API."

**Search targets (frozen):**
- `active runtime config`
- `effective runtime config`
- `runtime tool registry`
- `systemPrompt` accessor
- `getTools` accessor
- `getConfig` accessor
- `BuiltRuntime`
- `ActiveSession`
- `SessionRuntimeOrchestrator`

### Result 1 — `AgentRuntime.tools` field

`sdk/packages/agents/src/agent-runtime.ts:590`:

```typescript
private readonly tools = new Map<string, AgentTool<any, any>>();
```

**Private field. NO public getter.** Confirmed via grep
(`public\s+(get|list|read|current)\w*\s*\(` on agent-runtime.ts
returned zero results).

### Result 2 — `AgentRuntime.composeSystemPrompt` (n/a; not a method on AgentRuntime)

`composeSystemPrompt` lives on `SessionRuntimeOrchestrator`
(see next result), not on `AgentRuntime`.

### Result 3 — `SessionRuntimeOrchestrator.composeSystemPrompt`

`sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:802-819`:

```typescript
private async composeSystemPrompt(
    availableToolNames: ReadonlySet<string>,
): Promise<string> {
    const rules: string[] = []
    for (const rule of this.contributionRegistry.getRegisteredRules()) {
        if (
            rule.whenToolAvailable &&
            !availableToolNames.has(rule.whenToolAvailable)
        ) {
            continue
        }
        const content = await resolveRuleContent(rule)
        if (content) {
            rules.push(content)
        }
    }
    return mergeSystemPromptRules(this.config.systemPrompt, rules)
}
```

**PRIVATE method.** Returns the COMPOSED prompt (`config.systemPrompt`
+ registered rules filtered by available tools). But:
- NOT exposed on any public surface.
- Takes a `ReadonlySet<string>` of available tool names; not
  the full tool catalog.

### Result 4 — `LocalRuntimeHost` public API surface

`sdk/packages/core/src/runtime/host/local-runtime-host.ts`:

Public methods grepped (all method signatures, filtered to
non-`private`):
- `startSession` (line 398)
- `restoreSession` (line 1011)
- `runTurn` (line 1044)
- `subscribeRuntimeEvents` (line 1659)
- `updateSession` (config updater; line 1694)
- `getActiveRuntimeSnapshot` (line 1264) — snapshot, no
  prompt/tools (per Reviewer Finding 1).
- `captureHostOwnershipFacts` (line 1302) — provisional
  diagnostic, reads 6 raw ownership facts:
  `lastInteractiveTurnFinishReason`, `sessionStatus`,
  `pendingPromptCount`, `drainingPendingPrompts`, …
  (does NOT include prompt/tools; per the method's own
  javadoc: "PROVISIONAL ... deleted in its entirety at the
  first of (root cause classified, capture insufficient,
  successor evidence supersedes this diagnostic)").

**No public method exposes the effective runtime tool catalog
or composed system prompt.**

### Result 5 — `RuntimeHost` interface

`sdk/packages/core/src/runtime/host/runtime-host.ts`:

Optional methods only:
- `subscribeRuntimeEvents?` (line 467) — events only, not
  config.
- `getActiveRuntimeSnapshot?` (line 485) — snapshot, frozen to
  NOT have prompt/tools (per Reviewer Finding 1).

**No effective-runtime-config accessor on the shared interface.**

### Result 6 — `SdkSessionHost` interface (the one `runCompaction` actually sees)

`apps/vscode/src/sdk/session-host.ts`:

Methods present (all):
- `start` (27), `send` (29), `getAccumulatedUsage` (30),
  `abort` (31), `stop` (32), `dispose` (33), `get` (34),
  `list` (35), `listHistory` (36), `delete` (37),
  `readMessages` (38), `readLiveMessages?` (44),
  `updateSessionCompactionState?` (45), `restore` (46),
  `compareCheckpoint?` (48), `update` (49 — prompt/metadata/
  title only, NOT runtime config), `handleHookEvent` (57),
  `pendingPrompts` (58-60), `subscribe` (61),
  `subscribeRecoveryStateChange?` (75),
  `subscribeRuntimeEvents?` (86),
  `runtimeSnapshot?` (104),
  `updateSessionModel?` (105).

**`SdkSessionHost` exposes NO prompt accessor and NO tools
accessor.** The only runtime-related optional methods are
`subscribeRuntimeEvents?` (events only) and `runtimeSnapshot?`
(snapshot — frozen to NOT have prompt/tools).

### Result 7 — Coordinator's local knowledge

`apps/vscode/src/sdk/sdk-compaction-coordinator.ts:345-362`:

```typescript
private async runCompaction(sdkHost: SdkSessionHost, sessionId: string): Promise<void> {
    // ...
    const messages = (await sdkHost.readMessages(sessionId)) as SdkMessage[]
    // ...
    const config = await this.options.sessionConfigBuilder.build({ cwd, mode })
    // ...
}
```

The coordinator reads:
- `sdkHost.readMessages` (session messages — already exhausted
  by compaction itself).
- `options.getWorkspaceRoot()` (cwd).
- `options.sessionConfigBuilder.build({cwd, mode})` — the
  SESSION-CONFIG builder. The reviewer's
  `PROMPT_EQUIVALENCE = NOT_PROVEN` already covers this.

The coordinator does NOT reach `AgentRuntime`, `ActiveSession`,
or any effective-runtime-config accessor.

---

## Frozen discriminator verdict

```
EXACT_EFFECTIVE_PROMPT_EXISTING_SEAM = NO
EXACT_EFFECTIVE_TOOLS_EXISTING_SEAM  = NO

OUTCOME_X_RUNTIME_SNAPSHOT_PATH    = REJECTED
  (AgentRuntimeStateSnapshot does not expose prompt or tools;
   RuntimeHost/SdkSessionHost/ClineCore/LocalRuntimeHost chain
   all forward the same frozen snapshot type)

OUTCOME_C1_EXISTING_EFFECTIVE_SEAM = IMPOSSIBLE
  (no existing public method on RuntimeHost, LocalRuntimeHost,
   SdkSessionHost, AgentRuntime, or SessionRuntimeOrchestrator
   exposes the effective runtime tool catalog or the
   runtime-composed system prompt)

FULL_CANONICAL_MANUAL_W_WITHOUT_NEW_API = IMPOSSIBLE
  (file-07 closure of this file: confirmed by direct source
   inspection across 5 separate class hierarchies)

OUTCOME_C2_REVISITED
  = PRODUCT_DECISION_REQUIRED
    Option 1: APPROXIMATE_MANUAL_W
              - 3 minimal edits + 1 explicit estimator call
              - Sourced from session-config operands
              - V1_W_QUALITY = APPROXIMATION
              - SAME_BASE_METRIC = YES
              - OPERAND_COMPLETENESS = DIFFERENT
              - MANUAL_W = APPROXIMATION
              - NORMAL_TURN_W = CANONICAL
              - Bar will under-count for the interval between
                manual compaction completion and the next
                prepareTurn; the next prepareTurn's
                runtime-event publication will overwrite the
                carrier with the canonical W.
    Option 2: NO_IMMEDIATE_W_PUBLICATION
              - Don't compute W at the manual seam at all
              - Leave currentWorkingContextEstimate undefined
              - Bar stays stale (showing the PRE-compaction W)
                until the next prepareTurn overwrites it
              - Preserves truth but retains the visible
                stale-bar bug for the interval that matters to
                the user
```

---

## Frozen reviewer classification

```
P0 = NONE

P1
  OUTCOME_X_RUNTIME_SNAPSHOT_PATH is invalid:
    AgentRuntimeStateSnapshot does not expose
    systemPrompt or tools.

  FULL_CANONICAL_W still unbound:
    need one final search for an EXISTING effective-runtime-config
    read seam.

CLOSED
  raw compactor W return misconception
  config.extraTools equivalence overclaim
  W_QUALITY=CORRECT overclaim

  plus, THIS PASS:
  runtimeSnapshot HAS prompt/tools? = NO (closed)
  OUTCOME_X via runtimeSnapshot?       = REJECTED (closed)

P2
  "structural type lie" wording
  -> "RETURN-CONTRACT WIDENING / OPTIONAL-FIELD MISMATCH"
  prior evidence-label residue
  EOF/gate-summary residue
```

---

## Frozen product decision contract (when the ACT that decides between Option 1 / Option 2 lands)

```
MANUAL_W_QUANTITY_DECISION
  = NOT_FROZEN   (deferred to the next ACT — the one that
                  picks Option 1 or Option 2 as the
                  bounded delivery for the manual-seam
                  W publication)

IF OPTION_1 (APPROXIMATE_MANUAL_W)
  V1_W_QUALITY              = APPROXIMATION
  SAME_BASE_METRIC          = YES
  OPERAND_COMPLETENESS      = DIFFERENT
  MANUAL_W_OPERANDS         = sessionConfig.systemPrompt,
                              sessionConfig.extraTools ?? [],
                              result.messages
  NORMAL_W_OPERANDS         = runtime.tools (post-plugin),
                              runtime.config.systemPrompt,
                              context.messages
  EXPECTED_UNDER_COUNT_BIAS = POSITIVE (manual W is smaller
                              because it omits plugin tools
                              and addTools/MCP additions;
                              the BAR will read a smaller W
                              than reality until the next
                              prepareTurn overwrites it)
  NEXT_PREPARE_TURN_OVERWRITE
                            = CANONICAL (the existing
                              runtime-event subscription
                              path will publish the
                              canonical W on the next
                              turn boundary)
  DOCUMENTATION_REQUIRED
                            = honest label in
                              WorkingContextHostCapture
                              and the BAR that manual W
                              is APPROXIMATE; quantity
                              divergence quantified by
                              adding one explicit
                              discriminator test that
                              proves W(config tools) !=
                              W(effective runtime tools)
                              whenever a runtime-added
                              tool exists

IF OPTION_2 (NO_IMMEDIATE_W_PUBLICATION)
  V1_W_QUALITY              = NONE
  STALE_BAR_INTERVAL        = EXISTS (pre-compaction W
                              remains visible until next
                              prepareTurn)
  NEXT_PREPARE_TURN_OVERWRITE
                            = CANONICAL (same as Option 1)
  DOCUMENTATION_REQUIRED
                            = honest label that manual
                              compaction does not
                              publish immediate W;
                              the bar will update on
                              the next user turn
```

**The reviewer's preference**: "I would choose approximation
only if its error envelope is acceptably small and visible
semantics are documented." — i.e. Option 1 is defensible IF
both (a) the divergence is bounded by an explicit discriminator
test that proves `W(config tools) != W(effective runtime
tools)` for a constructed runtime-added tool, AND (b) the
APPROXIMATION label is honestly surfaced to consumers.

---

## Required RED (when ACT lands) — frozen

The reviewer mandated this RED shape (applies to Option 1 OR
Option 2):

```typescript
// real compactSessionMessages
// no mock of compaction producer

// known non-empty prompt
// known tool catalog
// real successful compaction

expect(result.currentWorkingContextEstimate).toBe(
    estimateRequestInputTokens({
        systemPrompt: effectivePromptAtCompaction,
        messages:     result.messages,
        tools:        effectiveToolsAtCompaction,
    }),
)

// mandatory discriminator
expect(expectedCanonicalW).not.toBe(
    estimateRequestInputTokens({
        systemPrompt: "",
        messages:     result.messages,
        tools:        [],
    }),
)

// if config-time tools used, explicitly construct a runtime-
// added tool and prove:
//   W(config tools) != W(effective runtime tools)
// so nobody can later relabel the approximation as canonical
```

For Option 2 (no immediate publication), the assertion changes
to:

```typescript
expect(result.currentWorkingContextEstimate).toBeUndefined()
// And: the next prepareTurn's runtime-event subscription
// fires with the canonical W.
```

---

## F1 factorization status — reviewer's note

The reviewer flagged a meta-point worth recording:

> "F1 began with: maybe two carrier mutation ingresses should
> become one. ... F1 discovered: one ingress is effectively
> dead because its upstream producer is broken.
> After this producer repair, reassess whether the original
> carrier factorization is worth doing at all."

**Frozen**: `F1_FACTORIZATION_REASSESSMENT = DEFERRED` until
the producer-repair ACT closes. If producer-repair yields a
single working ingress (the runtime-event one) and `setLatest`
remains unreachable, the original F1 factorization target
collapses to: extract `assign(W)` helper because both call
sites would otherwise write to the carrier directly.

But if producer-repair + the manual-seam approximation result
in TWO legitimate ingresses again (one runtime-event, one
manual-coordinator), the factorization re-opens.

**F1_FACTORIZATION_TARGET = NOT_YET_REEVALUATED**

---

## Frozen discriminators (the answer to "can RED finally start")

```
EXACT_EFFECTIVE_PROMPT_EXISTING_SEAM = NO
EXACT_EFFECTIVE_TOOLS_EXISTING_SEAM  = NO

FULL_CANONICAL_MANUAL_W_WITHOUT_NEW_API = IMPOSSIBLE

P0 = NONE
P1 = OUTCOME_X_RUNTIME_SNAPSHOT_PATH invalid (closed)
   + FULL_CANONICAL_W still unbound (closed: it's impossible
     without new API surface)
CLOSED:
  raw compactor W return misconception
  config.extraTools equivalence overclaim
  W_QUALITY=CORRECT overclaim
  runtimeSnapshot HAS prompt/tools?  (closed: NO)
  OUTCOME_X via runtimeSnapshot?        (closed: REJECTED)
P2 = "structural type lie" wording
   + prior evidence-label residue
   + EOF/gate-summary residue
```

---

## Repository identity (this ACT)

```
F0_CLOSURE_HEAD          = 49e7069c1eb56adf753286d72427f7bf17755925
LEAMAS_P2_ADDENDUM_HEAD  = 0debc0cc133ce54f02eff3e6e0d673c2571cbf40
F1_RECON_HEAD            = b8d11710e7c9ad6a58ebd1f636670cc5529c2f52
F1_DISCRIMINATOR_HEAD    = f737f43d3a4daf73f62a07b453e9077459625613
F1_CORRECTION04_HEAD     = fc8f070d2d12c2295635e81adbf7db5cf72c11d9
F1_CHARACTERIZATION_HEAD = 92b76de78689fe3ce7547bfb8ed7214b027806cb
F1_PRODUCER_RECON_HEAD   = 9daffdeeccdd7735fdbc34d2e10673bc71c7b027
F1_PRE_RED_DISCRIM_HEAD  = d4fd63ef1c45f684df8ff55ea6172481f54b26f3
F1_RETURN_SHAPE_HEAD     = 34997d1ff673c4495d823979f5c01ea2fca0499a
F1_RUNTIME_SNAPSHOT_HEAD = (this commit)
BRANCH                   = main
WORKTREE                 = clean (source inspection only)
```

---

## Final disposition

```
PHASE1_PRE_RED_DISCRIM_V2
  = PASS_WITH_BOUNDS_REPORTED
    (FULL_CANONICAL_MANUAL_W_WITHOUT_NEW_API = IMPOSSIBLE;
     OUTCOME_X rejected via direct source inspection;
     product decision between APPROXIMATE_MANUAL_W and
     NO_IMMEDIATE_W_PUBLICATION is the next ACT's
     responsibility)

RECOMMENDED NEXT ACT SCOPE (NOT in this commit)
  = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
    product-decision-and-red (bounded):
    1. Pick Option 1 (APPROXIMATE_MANUAL_W) or Option 2
       (NO_IMMEDIATE_W_PUBLICATION) as the bounded delivery.
    2. For Option 1: 3 minimal edits + 1 new explicit
       estimator call inside sdk-compaction.ts:184 +
       1 discriminator test (W(config tools) != W(effective
       runtime tools) with a constructed runtime-added tool).
    3. For Option 2: 0 edits inside sdk-compaction.ts:184;
       just stop trying to publish immediate W from manual
       compaction; the next prepareTurn overwrites.
    4. Run the existing test suite to confirm no regression.
    5. Update the bar documentation to honestly label the
       chosen semantics.

OUTCOME_X_RUNTIME_SNAPSHOT_PATH    = REJECTED (closed)
OUTCOME_C1_EXISTING_EFFECTIVE_SEAM = IMPOSSIBLE (closed)
OUTCOME_C2_PRODUCT_DECISION        = REQUIRED (next ACT)

P0 = NONE
P1 = OUTCOME_X_RUNTIME_SNAPSHOT_PATH invalid (closed)
   + FULL_CANONICAL_W still unbound (closed: impossible
     without new API surface)
P2 = "structural type lie" wording (re-classified as
     "RETURN-CONTRACT WIDENING / OPTIONAL-FIELD MISMATCH")
   + prior evidence-label residue
   + EOF/gate-summary residue

PRODUCTION_EDIT = NONE
TEST_EDIT       = NONE
```

The seventy-sixth-pass reviewer's directive is fully executed:
the snapshot abstraction is confirmed to NOT carry W operands,
no existing effective-runtime-config seam exists, and
`FULL_CANONICAL_MANUAL_W_WITHOUT_NEW_API = IMPOSSIBLE`. The
proposed Outcome X (file-07) is rejected. The next ACT must
make the bounded product decision between Option 1
(APPROXIMATE_MANUAL_W from session-config operands) and
Option 2 (NO_IMMEDIATE_W_PUBLICATION; next prepareTurn
overwrites). Until then, RED cannot start — the manual seam
either computes an APPROXIMATE W (Option 1) or publishes no W
at all (Option 2); neither yields `W_QUALITY = CANONICAL`.
