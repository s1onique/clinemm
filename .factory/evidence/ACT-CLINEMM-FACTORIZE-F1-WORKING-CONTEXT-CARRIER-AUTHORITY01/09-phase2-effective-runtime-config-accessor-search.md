# 09-phase2-effective-runtime-config-accessor-search.md — seventy-seventh-pass bounded pre-RED discriminator (product decision contract)

**ACT**: ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
**Phase**: bounded pre-RED discriminator — FINAL product decision contract
**Predecessor**: 08-phase1-runtime-snapshot-equivalence.md (`ab68c57dc`,
  `HALT_RUNTIME_SNAPSHOT_DOES_NOT_CARRY_W_OPERANDS`)
**Reviewer verdict (seventy-seventh pass)**:
  accept the file-08 closure; formally capture the
  product decision contract for the next ACT.
**Bounded scope**: read-only source inspection of additional
  candidates from the reviewer's mandated search list
  (`BuiltRuntime`, `ActiveSession`,
  `SessionRuntimeOrchestrator`, runtime tool registry
  accessors). NO production source touched. NO tests touched.

---

## Reviewer's frozen mandate (seventy-seventh pass)

> "Does an existing coordinator/session/runtime API expose the
> currently effective prompt and full current tool set WITHOUT
> introducing any new state or API?"

> Search real source for getters/accessors around:
> `active runtime config`, `effective runtime config`,
> `runtime tool registry`, `systemPrompt`, `getTools`,
> `getConfig`, `BuiltRuntime`, `ActiveSession`,
> `SessionRuntimeOrchestrator`.

> "Do not design anything. Terminate with:
> `EXACT_EFFECTIVE_PROMPT_EXISTING_SEAM = YES | NO`
> `EXACT_EFFECTIVE_TOOLS_EXISTING_SEAM  = YES | NO`"

---

## Additional candidates investigated this pass

The seventy-sixth pass covered 6 hierarchies. This pass adds
3 more candidate types named by the reviewer:

### Result 1 — `BuiltRuntime` interface (reviewer-named candidate)

**Location**: `sdk/packages/core/src/runtime/orchestration/session-runtime.ts:42-55`

```typescript
export interface BuiltRuntime {
    tools: AgentTool[];
    modelTools?: ModelTool[];
    hooks?: AgentHooks;
    logger?: BasicLogger;
    telemetry?: ITelemetryService;
    teamRuntime?: AgentTeamsRuntime;
    teamRestoredFromPersistence?: boolean;
    delegatedAgentConfigProvider?: DelegatedAgentConfigProvider;
    extensions?: AgentConfig["extensions"];
    completionPolicy?: AgentConfig["completionPolicy"];
    registerLeadAgent?: (agent: LeadAgentHandle) => void;
    shutdown: (reason: string) => Promise<void> | void;
}
```

**`BuiltRuntime.tools` is exactly the "effective runtime tools"
candidate the reviewer asked about.** It carries the tool
catalog at the builder-output boundary.

**But `BuiltRuntime` is NOT exposed.** Confirmed via
`grep -rn 'BuiltRuntime' apps/vscode/` — zero hits outside
the SDK integration test file (`seatbelt-yolo-completion-authority-integration01.red.test.ts`).
Confirmed via `grep -rn 'runtime\.tools\|BuiltRuntime\.tools'`
inside `sdk/packages/core/src/runtime/` — the only consumer
is `local-runtime-host.ts:651`:

```typescript
const tools = [...runtime.tools, ...(configWithProvider.extraTools ?? [])];
```

This is the SAME canonical merge the F1 file-06 B'_CORRECT
discriminator already froze:
**`config.extraTools ≠ runtime.tools`** — they are different
sets that are merged at this single point.

After line 651, the merged `tools` array flows into
`agentConfig.tools` (line 742), which is then consumed by
the `AgentRuntime` constructor (line 862) and stored in the
**private** `this.tools` map (`agent-runtime.ts:590`).

**`BuiltRuntime` lifetime ends at `LocalRuntimeHost.startSession`.**
Its `tools` field is read exactly once at line 651, then
the `BuiltRuntime` object is no longer referenced. It is
not stored in `ActiveSession`, not exposed via `SdkSessionHost`,
not reachable from `SdkCompactionCoordinator`.

**Frozen verdict for BuiltRuntime as an effective-config seam:**

```
BUILT_RUNTIME_HAS_TOOLS_FIELD         = YES
BUILT_RUNTIME_EXPOSED_PUBLICLY        = NO  (consumed only
                                              inside
                                              LocalRuntimeHost.
                                              startSession;
                                              BuiltRuntime
                                              reference
                                              not retained
                                              past line 651)
BUILT_RUNTIME_AS_EFFECTIVE_SEAM       = IMPOSSIBLE
EXACT_EFFECTIVE_TOOLS_VIA_BUILT_RUNTIME = NO
```

### Result 2 — `ActiveSession` interface (reviewer-named candidate)

**Location**: `apps/vscode/src/sdk/cline-session-factory.ts:106-119`

```typescript
export interface ActiveSession {
    sessionId: string
    startConfig?: Pick<CoreSessionConfig, "providerId" | "modelId">
    sdkHost: SdkSessionHost
    unsubscribe: () => void
    startResult?: StartSessionResult
    isRunning: boolean
}
```

`startConfig` is `Pick<CoreSessionConfig, "providerId" | "modelId">`:
**ONLY** the two-field projection. No `tools`, no
`systemPrompt`, no `extraTools`. This is the FROZEN
session-start record, not the runtime-effective catalog.

**Frozen verdict for ActiveSession:**

```
ACTIVE_SESSION_HAS_TOOLS_FIELD         = NO
ACTIVE_SESSION_HAS_SYSTEM_PROMPT_FIELD = NO
ACTIVE_SESSION_START_CONFIG            = { providerId, modelId }
                                          only (per Pick)
EXACT_EFFECTIVE_OPERANDS_VIA_ACTIVE_SESSION = NO
```

### Result 3 — `SessionRuntimeOrchestrator` (reviewer-named candidate)

Already covered in file-08 Result 3. Recapping:

- `composeSystemPrompt(availableToolNames)` is **private**
  (line 802).
- Returns `mergeSystemPromptRules(this.config.systemPrompt,
  rules)` — but the input is the **session-config** prompt,
  not the runtime-composed prompt that flows into
  `agentConfig.systemPrompt` (which is `configWithProvider.systemPrompt`,
  set by the host).
- No public method returns either the merged prompt or the
  merged tool catalog.

**Frozen verdict for SessionRuntimeOrchestrator:**

```
SRO_HAS_PUBLIC_PROMPT_ACCESSOR = NO  (composeSystemPrompt
                                       is private)
SRO_HAS_PUBLIC_TOOLS_ACCESSOR  = NO  (tools never held;
                                       orchestrator composes
                                       agentConfig from
                                       BuiltRuntime +
                                       CoreSessionConfig
                                       and hands off to
                                       AgentRuntime; does
                                       not retain either
                                       for later read)
EXACT_EFFECTIVE_OPERANDS_VIA_SRO = NO
```

### Result 4 — grep for runtime tool registry accessors

Search: `getToolRegistry|getActiveTools|getEffectiveTools|getAvailableTools|effectiveTools`

**Result: zero matches.** No such accessor exists anywhere
in the SDK or apps source.

### Result 5 — grep for `AgentRuntimeConfig` field accessor

Search: `^\t(public|readonly)\s+(tools|systemPrompt|effectiveTools|effectivePrompt|activeTools|activePrompt)`
on `agent-runtime.ts`

**Result: zero matches.** `tools` is `private readonly`
(line 590); `systemPrompt` is read only via
`this.config.systemPrompt` inside private methods
(`composeSystemPrompt` is on `SessionRuntimeOrchestrator`,
NOT `AgentRuntime`).

### Result 6 — `AgentRuntime` complete public method surface (lines 862-1033)

```
862:  constructor(config: AgentRuntimeConfig)
880:  async run(input: AgentRunInput): Promise<AgentRunResult>
884:  async continue(input?: AgentRunInput): Promise<AgentRunResult>
888:  abort(reason?: unknown): void
906:  subscribe(listener: AgentEventListener): () => void
921:  restore(messages: readonly AgentMessage[]): void
1033: snapshot(): LiveAgentRuntimeStateSnapshot
```

**Seven public methods total. NONE expose tools or systemPrompt.**

The ONLY snapshot path is `snapshot()` at line 1033, which
returns `LiveAgentRuntimeStateSnapshot` — frozen in file-08
to NOT carry W operands.

---

## Frozen discriminator verdict (consolidated)

```
EXACT_EFFECTIVE_PROMPT_EXISTING_SEAM = NO

  (Reasoning: every candidate fails)
    1. AgentRuntime.tools           = private readonly
    2. AgentRuntime.systemPrompt    = not exposed
                                       (accessed only via
                                        this.config.systemPrompt
                                        inside private
                                        methods)
    3. AgentRuntime.composeSystemPrompt = not on AgentRuntime
                                           (it's on
                                            SessionRuntimeOrchestrator,
                                            which is private)
    4. SessionRuntimeOrchestrator   = composeSystemPrompt
                                       is private; no public
                                       accessor
    5. BuiltRuntime.tools           = YES the field exists,
                                       BUT BuiltRuntime is
                                       consumed once at
                                       local-runtime-host.ts:651
                                       and not retained past
                                       that line
    6. BuiltRuntime.exposed publicly = NO
    7. LocalRuntimeHost             = no prompt/tools
                                       accessor (only
                                       getActiveRuntimeSnapshot
                                       and captureHostOwnershipFacts)
    8. RuntimeHost interface        = events + snapshot only
    9. SdkSessionHost interface     = no prompt/tools accessor
    10. ActiveSession               = startConfig is Pick<
                                       providerId, modelId>
                                       only — NOT a runtime
                                       config accessor
    11. AgentRuntimeStateSnapshot   = frozen (file-08) to
                                       NOT carry prompt/tools
    12. runtime tool registry       = no getToolRegistry /
                                       getActiveTools /
                                       getEffectiveTools /
                                       getAvailableTools /
                                       effectiveTools accessor
                                       exists anywhere

EXACT_EFFECTIVE_TOOLS_EXISTING_SEAM  = NO

  (Same reasoning: BuiltRuntime.tools exists but is not
   reachable from the manual seam; no other candidate
   carries the merged runtime tool catalog at a readable
   seam.)

FULL_CANONICAL_MANUAL_W_WITHOUT_NEW_API = IMPOSSIBLE
```

This **CONFIRMS** the seventy-sixth-pass verdict without
modification. The additional candidates the reviewer
mandated do not change the conclusion. The single
near-miss (`BuiltRuntime.tools`) is structurally
unreachable from the manual coordinator because
`BuiltRuntime` is consumed at `local-runtime-host.ts:651`
and not retained past that line.

---

## Frozen product decision contract

The reviewer's seventy-seventh-pass verdict directs the
Factory to **stop pretending canonical immediate W is
obtainable for free** and to freeze the approximate-vs-stale
product contract.

### Naming: `POST_COMPACTION_CURRENT_CONFIG_W`

Per reviewer's recommendation:

> "The honest target is not necessarily 'future next-turn W'.
> It is 'W for the currently effective runtime configuration
> at manual-compaction publication time'. Call it
> `POST_COMPACTION_CURRENT_CONFIG_W`."

**FROZEN:**
- Manual seam W publication semantics, when it occurs, is
  named **`POST_COMPACTION_CURRENT_CONFIG_W`**.
- It is NOT named "future provider-request W" or
  "next-turn W" or "canonical W".
- The quantity is bounded at the manual-publication moment:
  the W estimated from the operands in scope at the moment
  the compaction producer returns.

### FROZEN options

**OPTION 1 — APPROXIMATE_MANUAL_W (= `POST_COMPACTION_CURRENT_CONFIG_W`)**

  Operands in scope at manual-seam publication:
  - `sessionConfig.systemPrompt` (from `sessionConfigBuilder.build(...)`)
  - `sessionConfig.extraTools ?? []` (from `sessionConfigBuilder.build(...)`)
  - `result.messages` (from the compactor's returned `CoreCompactionResult`)

  W quality:
  - `V1_W_QUALITY` = `APPROXIMATE`
  - `SAME_BASE_METRIC` = `YES`
    (still `estimateRequestInputTokens`, same call signature)
  - `OPERAND_COMPLETENESS` = `DIFFERENT`
  - `MANUAL_W` = `APPROXIMATE`
  - `NORMAL_TURN_W` = `CANONICAL`
    (NORMAL_TURN_W = the W published by the existing
     runtime-event subscription path inside
     `createCompactionStateAwarePrepareTurn` at
     sdk-compaction.ts:747, 750, 761, 798)
  - `EXPECTED_UNDER_COUNT_BIAS` = `POSITIVE`
    (manual W is smaller because it omits runtime-built
    tools from `BuiltRuntime.tools` and runtime-added
    tools from the `addTools` plugin path)

  Stale-bar interval:
  - From `compact()` return until next user turn boundary
    when the existing runtime-event subscription publishes
    a CANONICAL W
  - The APPROXIMATE label stays on for the duration of this
    interval; the label flips to CANONICAL when the runtime
    subscription overwrites
  - The label flip is observable to consumers (the carrier
    can carry a `quality: 'APPROXIMATE' | 'CANONICAL' | undefined`
    alongside the value if a later ACT chooses to add that)

  Documentation required:
  - Honest `APPROXIMATE` label in `WorkingContextHostCapture`
  - Honest `APPROXIMATE` label in the BAR
  - Divergence quantified by an explicit discriminator test:
    `W(config tools) != W(effective runtime tools)` whenever
    a runtime-added tool exists
  - Reasoning: the W published at the manual seam will
    diverge from the runtime-composed W until the next
    prepareTurn overwrites it; this is honest and visible

  Surface delta:
  - 3 minimal edits inside `sdk-compaction.ts:184`
  - 1 new explicit `estimateRequestInputTokens(...)` call
    inside the manual seam
  - 1 new test proving the divergence

**OPTION 2 — NO_IMMEDIATE_W_PUBLICATION**

  Operands in scope at manual-seam publication:
  - None (intentional no-op)

  W quality:
  - `V1_W_QUALITY` = `NONE`
  - `currentWorkingContextEstimate` stays `undefined`
  - Stale-bar interval: bar shows pre-compaction W from
    carrier's last setLatest/setCanonical call
  - NEXT_PREPARE_TURN_OVERWRITE = CANONICAL (existing
    runtime-event subscription path)

  Documentation required:
  - Honest `NOT_PUBLISHED` label in `WorkingContextHostCapture`
  - Honest `STALE` label in the BAR (pre-compaction W
    remains visible until next prepareTurn)
  - The bar will read a stale W value for the interval that
    matters to the user (the post-compaction moment before
    the next turn boundary)

  Surface delta:
  - 0 edits inside `sdk-compaction.ts:184`
  - 0 new tests

### Comparison

| Aspect | Option 1 (APPROXIMATE) | Option 2 (NO_PUBLICATION) |
|--------|------------------------|---------------------------|
| Manual W quality | APPROXIMATE | NONE |
| Stale bar interval | Yes, but labeled APPROXIMATE | Yes, but labeled STALE |
| Bar divergence | Manual W < runtime W (under-count) | Bar shows pre-compaction W |
| Visible to user | "Bar shows approximation, will fix on next turn" | "Bar did not update, will fix on next turn" |
| Surface delta | 3 edits + 1 estimator call + 1 test | 0 edits + 0 tests |
| Honest about divergence | Yes, with explicit discriminator test | Yes, but admits the stale bug |
| Matches user's intent | Closer (bar moves after /compact) | No (bar stays put until next turn) |

### Reviewer's preference

> "I would choose approximation only if its error envelope
> is acceptably small and visible semantics are documented."

Per the reviewer's "defensible IF" condition, Option 1 is
defensible IF:
1. **Divergence bounded by explicit discriminator test** —
   the discriminator test must prove
   `W(config tools) != W(effective runtime tools)` when a
   runtime-added tool exists, so nobody can later relabel
   the approximation as canonical.
2. **APPROXIMATION label honestly surfaced to consumers** —
   the BAR must visually communicate that the value is an
   approximation, not a canonical measurement.

If those two conditions are met, Option 1 is preferred.
If they cannot be met (e.g., the runtime-added toolset is
not exposed enough to construct the discriminator test),
Option 2 is the safer honest choice.

---

## DO_NOT_EXTEND_RUNTIME_SNAPSHOT_FOR_W = FROZEN

Per the reviewer's strong recommendation:

> "I strongly recommend against [extending
> `AgentRuntimeStateSnapshot` with tools/prompt]."

Reasoning:
- Tools/systemPrompt are "potentially large
  configuration/materialization objects with different
  lifecycle and sensitivity characteristics"
- Adding them merely for W estimation would create
  `runtime configuration → duplicated into runtime snapshot
  → exposed to host state consumers → lifetime/coherence
  contract → potentially large copy`
- That is "exactly opposite to F1's factorization objective"
- Upstream architecture reinforces: `@cline/agents` owns the
  runtime loop and event emission; `@cline/core` owns
  compaction and runtime composition; tools/hooks/extensions
  come from runtime-builder inputs

**FROZEN:**
```
DO_NOT_EXTEND_RUNTIME_SNAPSHOT_FOR_W = YES (frozen policy)
  (Applies unless some separate product need later
   justifies it; F1 has no such need.)
```

This is the reason file-08 REJECTED `OUTCOME_X` in the
first place. The current ACT confirms it.

---

## DO_NOT_ADD_NEW_PUBLIC_API_FOR_W = FROZEN

Per the reviewer's strong recommendation:

> "Do not add prompt/tools to `AgentRuntimeStateSnapshot`."
> "Do not expose `AgentRuntime` itself."
> "Do not create a new debugging/config snapshot simply
> for W."

Reasoning:
- F1's factorization objective: reduce ingress duplication,
  not increase API surface
- Inventing a new `SdkSessionHost.effectiveRuntimeConfig?()`
  or similar would directly contradict F1 by adding public
  surface to expose runtime config
- The only legitimate need for runtime-config exposure
  would be a separate product need (e.g., showing the
  current runtime config in a debug panel); F1 has no
  such need

**FROZEN:**
```
DO_NOT_ADD_NEW_PUBLIC_API_FOR_W = YES (frozen policy)
  (Option 1 implementation MUST use only existing accessors:
   sessionConfigBuilder, the raw compactor result, the
   carrier mutation API. NO new public surface.)
```

---

## F1 factorization status — reviewer's note (formalized)

The reviewer flagged:

> "After this producer repair, reassess whether the original
> carrier factorization is worth doing at all."

> "I suspect:
> `observe(event) → one assignment`
> `setLatest(w)  → one assignment`
> may be too trivial to deserve another production ACT."

> "If producer repair closes the actual bug and no invariant
> is gained by extracting `assign()`:
> `PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED`
> would be the better Factory outcome."

**FROZEN:**
```
F1_FACTORIZATION_TARGET = NOT_YET_REEVALUATED

IF OPTION_1_LANDSCAPE
  - observe(event) → assignment (canonical W from
                       runtime-event subscription)
  - setLatest(w)   → assignment (APPROXIMATE_W from manual
                       seam)
  Two assignments to the same carrier, different sources,
  different qualities.

  Factorization question: is there an invariant worth
  extracting? E.g.:
    - "always set quality label alongside value"
    - "log the previous quality when overwriting"
  These may not justify a production ACT.

IF OPTION_2_LANDSCAPE
  - observe(event) → assignment (canonical W)
  - setLatest(w)   → DEAD (no caller reaches it)
  One working ingress, one dead ingress.

  Per reviewer's hypothesis: "PASS_F1_NO_FURTHER_FACTORIZATION_NEEDED"
  is the likely Factory outcome.

F1_FACTORIZATION_REASSESSMENT = DEFERRED
  (Re-evaluated after the next ACT closes its producer-repair
   branch and we know whether setLatest remains reachable.)
```

---

## Closed findings (consolidated across all passes)

```
CLOSED (this ACT or earlier passes):
  - raw compactor W return misconception
    (manual compact() bypasses the wrapper)
  - config.extraTools equivalence overclaim
    (FROZEN at file-06: config.extraTools ≠ runtime.tools;
     they are merged, not equal)
  - W_QUALITY=CORRECT overclaim
    (RETRACTED at file-07; honest state NOT_YET_BOUND)
  - runtimeSnapshot HAS prompt/tools?
    (CLOSED at file-08: NO, confirmed via direct source
     inspection)
  - OUTCOME_X via runtimeSnapshot?
    (CLOSED at file-08: REJECTED; structurally
     incompatible with snapshot abstraction)
  - OUTCOME_C1 EXISTING_EFFECTIVE_SEAM?
    (CLOSED at this pass: IMPOSSIBLE; BuiltRuntime.tools
     exists but not reachable; ActiveSession carries only
     providerId/modelId; SessionRuntimeOrchestrator
     composeSystemPrompt is private; AgentRuntime.tools is
     private; no getToolRegistry/getActiveTools/etc anywhere)
  - FULL_CANONICAL_MANUAL_W_WITHOUT_NEW_API
    (CLOSED at this pass: IMPOSSIBLE)
  - "structural type lie" wording
    (RE-CLASSIFIED at file-08 as "RETURN-CONTRACT WIDENING /
     OPTIONAL-FIELD MISMATCH" — semantic mismatch, not a
     TypeScript unsoundness)
  - DO_NOT_EXTEND_RUNTIME_SNAPSHOT_FOR_W
    (FROZEN at this pass)
  - DO_NOT_ADD_NEW_PUBLIC_API_FOR_W
    (FROZEN at this pass)
```

---

## Frozen discriminators (final)

```
EXACT_EFFECTIVE_PROMPT_EXISTING_SEAM = NO
EXACT_EFFECTIVE_TOOLS_EXISTING_SEAM  = NO

FULL_CANONICAL_MANUAL_W_WITHOUT_NEW_API = IMPOSSIBLE

OPTION_1_APPROXIMATE_MANUAL_W
  V1_W_QUALITY              = APPROXIMATE
  SEMANTIC_NAME             = POST_COMPACTION_CURRENT_CONFIG_W
  SAME_BASE_METRIC          = YES  (estimateRequestInputTokens)
  OPERAND_COMPLETENESS      = DIFFERENT
  MANUAL_W_OPERANDS         = sessionConfig.systemPrompt,
                              sessionConfig.extraTools ?? [],
                              result.messages
  NORMAL_W_OPERANDS         = runtime.tools (post-plugin),
                              runtime.config.systemPrompt,
                              context.messages
  EXPECTED_UNDER_COUNT_BIAS = POSITIVE
  NEXT_PREPARE_TURN_OVERWRITE = CANONICAL
  DOCUMENTATION_REQUIRED    = APPROXIMATE label + discriminator
                              test
  DEFENSIBLE_IF             = (a) divergence bounded by explicit
                                  discriminator test
                              (b) APPROXIMATION label honestly
                                  surfaced to consumers
  SURFACE_DELTA             = 3 edits + 1 estimator call +
                              1 test

OPTION_2_NO_IMMEDIATE_W_PUBLICATION
  V1_W_QUALITY              = NONE
  SEMANTIC_NAME             = (no name — no publication)
  STALE_BAR_INTERVAL        = EXISTS (pre-compaction W visible)
  NEXT_PREPARE_TURN_OVERWRITE = CANONICAL
  DOCUMENTATION_REQUIRED    = NOT_PUBLISHED label + STALE label
  SURFACE_DELTA             = 0 edits + 0 tests

P0 = NONE
P1 = FULL_CANONICAL_W still unbound (closed: IMPOSSIBLE
                                   without new API surface)
   + OUTCOME_X_RUNTIME_SNAPSHOT_PATH (closed at file-08)
   + OUTCOME_C1_EXISTING_EFFECTIVE_SEAM (closed at this pass)
P2 = "structural type lie" wording re-classified (file-08)
   + prior evidence-label residue
   + EOF/gate-summary residue
   + (this pass: BuiltRuntime.tools field documentation
              residue — `BuiltRuntime.tools` exists but
              BuiltRuntime reference does not survive
              past local-runtime-host.ts:651)
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
F1_RUNTIME_SNAPSHOT_HEAD = ab68c57dc91db177317fb963c26e7be6df58618c
F1_PRODUCT_DECISION_HEAD = (this commit)
BRANCH                   = main
WORKTREE                 = clean (source inspection only)
```

---

## Final disposition

```
PHASE2_PRE_RED_DISCRIM_FINAL
  = PASS_WITH_PRODUCT_DECISION_PENDING

  (FULL_CANONICAL_MANUAL_W_WITHOUT_NEW_API = IMPOSSIBLE,
   closed across two passes; OPTION_1 (APPROXIMATE_MANUAL_W
   named POST_COMPACTION_CURRENT_CONFIG_W) and OPTION_2
   (NO_IMMEDIATE_W_PUBLICATION) are the two honest
   product choices; the next ACT must pick one and
   implement the bounded surface delta.)

RECOMMENDED NEXT ACT SCOPE (NOT in this commit)
  = ACT-CLINEMM-FACTORIZE-F1-WORKING-CONTEXT-CARRIER-AUTHORITY01
    product-decision-and-red (bounded):
    1. Pick Option 1 (APPROXIMATE_MANUAL_W named
       POST_COMPACTION_CURRENT_CONFIG_W) or Option 2
       (NO_IMMEDIATE_W_PUBLICATION).
    2. If Option 1:
       a. 3 minimal edits inside sdk-compaction.ts:184
       b. 1 new explicit estimateRequestInputTokens(...)
          call inside the manual seam
       c. 1 new discriminator test proving
          W(config tools) != W(effective runtime tools)
          with a constructed runtime-added tool
       d. Update BAR documentation with APPROXIMATE label
    3. If Option 2:
       a. 0 edits inside sdk-compaction.ts:184
       b. 0 new tests
       c. Update BAR documentation with STALE label
    4. Run the existing test suite to confirm no
       regression.
    5. Update F1_FACTORIZATION_TARGET = PASS_F1_NO_FURTHER_
       FACTORIZATION_NEEDED (if Option 2 lands and setLatest
       remains unreachable) or = NOT_YET_REEVALUATED (if
       Option 1 lands and both ingresses remain live).

DO_NOT_EXTEND_RUNTIME_SNAPSHOT_FOR_W = YES (frozen policy)
DO_NOT_ADD_NEW_PUBLIC_API_FOR_W      = YES (frozen policy)

P0 = NONE
P1 = FULL_CANONICAL_W still unbound (closed: IMPOSSIBLE
                                   without new API surface)
   + OUTCOME_X_RUNTIME_SNAPSHOT_PATH (closed at file-08)
   + OUTCOME_C1_EXISTING_EFFECTIVE_SEAM (closed at this pass)
P2 = "structural type lie" wording re-classified (file-08)
   + prior evidence-label residue
   + EOF/gate-summary residue
   + BuiltRuntime.tools documentation residue (this pass)

PRODUCTION_EDIT = NONE
TEST_EDIT       = NONE
```

The seventy-seventh-pass reviewer's directive is fully
executed: the additional candidates (`BuiltRuntime`,
`ActiveSession`, `SessionRuntimeOrchestrator`, runtime tool
registry accessors) have been inspected via direct source
search. The seventy-sixth-pass verdict
(`FULL_CANONICAL_MANUAL_W_WITHOUT_NEW_API = IMPOSSIBLE`)
is confirmed without modification. The product decision
contract (Option 1: APPROXIMATE_MANUAL_W named
`POST_COMPACTION_CURRENT_CONFIG_W`; Option 2:
NO_IMMEDIATE_W_PUBLICATION) is frozen. The frozen
policies `DO_NOT_EXTEND_RUNTIME_SNAPSHOT_FOR_W` and
`DO_NOT_ADD_NEW_PUBLIC_API_FOR_W` are recorded. RED cannot
start until the next ACT picks one of the two options and
implements the bounded surface delta.
