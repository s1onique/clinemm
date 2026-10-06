# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01 — Production-Seam Recon

**Subject HEAD:** `944fe422a` (ACT-MYC-CLINEMM-TASK-HEADER-TELEMETRY01 CORRECTION03 LIVE-GO)
**Date:** 2026-10-06
**Author:** ACT executor

This recon identifies the actual Task Header **pure orchestration seam** in the
current production tree. The Elm extraction (C1/C4) MUST be derived from this
evidence, not from the ACT prose.

---

## 1. Production selector

**Location:** `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts`

**Symbol:** `selectTaskHeaderPresentation(input: TaskHeaderPresentationInputs): TaskHeaderPresentationProjection`

- Definition: lines `418–469` (the `TaskHeaderPresentationInputs` interface)
- Definition: lines `387–416` (the `TaskHeaderPresentationProjection` interface)
- Body: lines `559–644` (the 4-rule precedence selector)

**Semantic shape (verbatim from source):**

```ts
export interface TaskHeaderPresentationProjection {
    phase: TurnPhase                                          // 8-phase vocabulary
    source: "host" | "shadow" | "legacy"                      // provenance
    seq: number                                               // monotonic TurnState stamp
}

export interface TaskHeaderPresentationInputs {
    readonly canonicalShadowPhase: TurnPhase | undefined
    readonly currentLegacyPhase: TurnPhase
    readonly seq: number
    readonly canonicalShadowObservedTurnSeq?: number         // CORRECTION02 same-domain stamp
}
```

The function body is a non-throwing pure function (no `try`, no `async`, no
`await`, no global reads, no clock reads). All four inputs are read-only;
all three outputs are constructed fresh. **This is the pure orchestration
seam.**

---

## 2. Production rules (frozen by `selectTaskHeaderPresentation` body)

```text
1. HOST COMPACTION OVERRIDE
   if currentLegacyPhase === "compacting"
     → { phase: "compacting", source: "host", seq }

2. HOST AWAITING_FOLLOWUP OVERRIDE
   else if currentLegacyPhase === "awaiting_followup"
     → { phase: "awaiting_followup", source: "host", seq }

3. CANONICAL SHADOW
   else if canonicalShadowPhase !== undefined
     let isShadowStale =
         canonicalShadowObservedTurnSeq !== undefined
         && seq > canonicalShadowObservedTurnSeq
     let isUnboundDemotingActiveToTerminal =
         canonicalShadowObservedTurnSeq === undefined
         && isTerminalShadowPhase canonicalShadowPhase
         && isActiveLegacyPhase currentLegacyPhase
     if !isShadowStale && !isUnboundDemotingActiveToTerminal
       → { phase: canonicalShadowPhase, source: "shadow", seq }

4. ABSENCE FALLBACK
   else
     → { phase: currentLegacyPhase, source: "legacy", seq }
```

where

```text
isTerminalShadowPhase phase =
    phase === "idle" || phase === "completed" || phase === "error" || phase === "resumable"
isActiveLegacyPhase phase =
    phase === "streaming" || phase === "awaiting_approval"
```

The two terminal-shadow / active-legacy sets are the load-bearing guard added
by ACT-CLINEMM-TASKHEADER-UNBOUND-SHADOW-AUTHORITY-RECON01. They bound the
authority of an UNBOUND shadow (no `canonicalShadowObservedTurnSeq`).

---

## 3. Canonical source — writer/read path

The canonical shadow phase is the `turnPhase` of the LAST observed
`ArbiterSnapshot`. The writer is the `@cline/agents` TaskState shadow
recorder + host wiring; the readers are:

- `apps/vscode/src/sdk/SdkController.ts:3013` — `getLocalShadowPhase()`
  returns `this.taskStateShadowWiring?.getLastObservedShadowPhase()`.
- `apps/vscode/src/sdk/SdkController.ts:3043` —
  `getLocalShadowTurnSeqForPhase(phase)` returns the per-phase stamp from
  the same wiring.
- `apps/vscode/src/sdk/SdkController.ts:5848–5901` — the call site that
  feeds `selectTaskHeaderPresentation` for `getStateToPostToWebview()`,
  with the **CORRECTION03 phase-keyed stamp** that collapses noop
  observations of the same phase.

The canonical shadow is the authority for 6 of the 8 phases (idle,
streaming, awaiting_approval, completed, error, resumable). It cannot
represent `compacting` or `awaiting_followup` (these are host-owned by
construction; see the JSDoc above the rules at
`task-state-shadow-arbiter-mapper.ts:471–512`).

---

## 4. Legacy source — writer/read path

The legacy phase lives on the host-owned `TurnStateTracker`. The writer
is the `SdkController` itself (every lifecycle transition calls
`turnStateTracker.set(phase)`); the reader is the same class:

- `apps/vscode/src/sdk/SdkController.ts:2391` —
  `getCurrentLegacyPhase: () => this.turnStateTracker.currentPhase`
  (also passed into the `createCanonicalRestorePhaseCallback` factory).
- `apps/vscode/src/sdk/SdkController.ts:5885` — the
  `currentLegacyPhase: this.turnStateTracker.currentPhase` argument
  feeding `selectTaskHeaderPresentation`.

The legacy source is the **absence fallback**: it is read ONLY in
branches 2 (host override for `awaiting_followup`) and 4 (when
`canonicalShadowPhase === undefined`). It is also consulted at branch 1
(host override for `compacting`). By construction (per
`T2_LEGACY_INDEPENDENCE` invariant), branches 1+2+3 are independent of
the legacy value's *non-overridden* paths.

---

## 5. Publication binding — `publicationShadowBinding`

**Definition:** `apps/vscode/src/sdk/task-header-selector-input-capture.ts:79–82`

```ts
readonly publicationShadowBinding: "MISSING" | "UNBOUND"
readonly canonicalShadowPhase: TurnPhase | undefined
readonly localShadowTurnSeq: number | undefined
readonly currentLegacyPhase: TurnPhase
readonly seq: number
```

**Writer:** `apps/vscode/src/sdk/SdkController.ts:6030`

```ts
const shadowForBinding = this.getLocalShadowProjection()
const publicationShadowBinding: "MISSING" | "UNBOUND" =
    shadowForBinding === undefined ? "MISSING" : "UNBOUND"
```

The classifier is **deterministic**: `"MISSING"` iff `getLocalShadowProjection()`
returns `undefined` (no observation has happened yet — Hub/Remote hosts and
Local pre-observation); `"UNBOUND"` iff a snapshot is present but carries
no `canonicalShadowObservedTurnSeq` (the snapshot is the latest observed
arbiter but the recording layer did not stamp a TurnState-domain
generation on this specific projection).

**Reader:** The binding is consumed at
`apps/vscode/src/sdk/task-header-selector-input-capture.ts:148–156`
inside the bounded diagnostic capture helper. The production selector
itself does NOT inspect the binding value — the binding's effect is
encoded by the rule-3 dual gate (`isShadowStale` AND
`isUnboundDemotingActiveToTerminal`), which collapses the
`canonicalShadowObservedTurnSeq === undefined` UNBOUND branch.

**Expected transition to a non-`UNBOUND` state:**
`canonicalShadowObservedTurnSeq !== undefined` becomes true when
`getLocalShadowTurnSeqForPhase(currentShadowPhase)` returns a number.
This is wired through the `taskStateShadowWiring` once the wiring
records an observation stamped with the live `turnStateTracker.seq`.

---

## 6. Rendering boundary

**File:** `apps/vscode/webview-ui/src/components/chat/task-header/TaskHeader.tsx`

The component receives `taskHeaderPresentation?: TaskHeaderPresentationProjection`
as a prop (with `useExtensionState()` as the default source). The
canonical projection is consumed at:

- `TaskHeader.tsx:106–132` (preference: prop → context mirror)
- `TaskHeader.tsx:257–263` (passed to `<TaskHeaderTelemetry>` for the
  strip)
- `TaskHeaderTelemetry.tsx` (state label derivation; see also the
  `taskHeaderPresentationStateLabel` helper at
  `taskHeaderTelemetryHelpers.ts:220–228`).

The TaskHeader component is purely a **host for JSX**. The phase text,
glyph, and accessibility labels are pure projections of the
`taskHeaderPresentation.phase` value. No business policy lives in JSX.

---

## 7. Effectful operations in the production seam

**None.** `selectTaskHeaderPresentation` does not:

- call any host-owned setter / mutator;
- read or write `turnStateTracker`;
- read or write `taskStateShadowWiring`;
- read or write any session / control / task state;
- emit telemetry / log / `console.*`;
- invoke MCP, myc, CLI, ACP, file, network, or process APIs;
- depend on wall-clock time or random sources.

All four inputs are read-only snapshots of host-owned state. All three
outputs are pure. **No effectful operations remain inside the seam.**

---

## 8. Temporal dependency analysis

**Short answer:** `seq > canonicalShadowObservedTurnSeq` is a numeric
comparison of two integers in the **same monotonic domain**
(`TurnStateTracker.seq`). It is not an FSM transition.

**Long answer:**

- `seq` is `this.turnStateTracker.get().seq` (a strictly monotonic
  counter that advances on every `turnStateTracker.set(phase)` call).
- `canonicalShadowObservedTurnSeq` is stamped with the
  `turnStateTracker.seq` value at the moment the shadow accepted the
  observation that produced the projection currently being read
  (`wiring.getLastObservedTurnSeqForPhase(phase)`, same domain).
- Both values are typed as `number` (the `number | undefined` shape on
  the input is just the absence-collapse, not a separate identity).
- `isShadowStale` is purely a numeric `>` test on these two integers.

So the "temporal" axis is encoded entirely as a comparison of two ints.
The selector as a whole is **a pure function of the four inputs above**;
the four inputs are themselves read-only snapshots.

**Decision:** the Elm shape is a **single pure function**
`Facts -> Result ProjectionError Presentation`
(see C4 in the ACT). No `Model` / `Msg` / `update` boundary is required.

---

## 9. Current tests exercising the same presentation seam

The pre-Elm fixture suite (C3 of the ACT) will execute the real
production selector (`selectTaskHeaderPresentation`) directly:

| Test file | Why it's relevant |
|---|---|
| `apps/vscode/src/sdk/__tests__/task-header-canonical-task-activity-ownership.cta01.test.ts` | NEG witnesses + the three-rule selector shape |
| `apps/vscode/src/sdk/__tests__/task-header-projection-coherence-repair01.tcr01.test.ts` | Staleness fence + UNBOUND demotion |
| `apps/vscode/src/sdk/__tests__/task-header-unbound-shadow-authority.tusa01.test.ts` | UNBOUND demotion guard (rule 3 dual gate) |
| `apps/vscode/src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts` | Real production seam with `taskStateShadowWiring` |
| `apps/vscode/src/sdk/__tests__/sdk-compaction-coordinator.task-header-projection.thcp11.test.ts` | Host-override branch (`compacting` pinned) |
| `apps/vscode/src/sdk/__tests__/task-completion-continuation-coherence.tccc01.test.ts` | `awaiting_followup` host override |
| `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc01.c24-c-bridge.test.ts` | Real SdkController composition + selector |
| `apps/vscode/src/sdk/__tests__/application-ownership-projection-coherence.aopc02.c24-c-bridge.test.ts` | Real SdkController + UNBOUND demotion |

New test files added by this ACT:

| Test file | Purpose |
|---|---|
| `apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.fixtures.ts` | Reference 12-state fixture table |
| `apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.test.ts` | Differential correspondence (TS == Elm) |
| `apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.malformed-edges.test.ts` | Fail-closed boundary tests |
| `apps/vscode/elm/task-header-orchestration/tests/TaskHeaderOrchestrationTest.elm` | Elm-side unit tests for the same fixtures + malformed inputs |

---

## 10. Safely observable

The following are safely observable from the production selector **at the
seam only** (no state mutation, no observable host side effect):

- The four inputs to `selectTaskHeaderPresentation` (already exposed by the
  diagnostic capture at `task-header-selector-input-capture.ts`).
- The three outputs of `selectTaskHeaderPresentation` (already exposed
  on `ExtensionState.taskHeaderPresentation` since the THCP01 migration).
- The `publicationShadowBinding` classification value (already exposed
  on the diagnostic capture).

The Elm kernel will receive the four inputs and emit the three outputs
across a single closed tagged JSON boundary (Main.elm's
`Platform.worker` pattern, modeled exactly on the completion-authority
kernel).

## 11. NOT safely observable

The following are NOT in the Elm boundary:

- Wall-clock time (not a semantic input to the selector).
- Random sources (the selector is deterministic).
- File system / network / MCP / VS Code APIs (the selector reads no I/O).
- React rendering / DOM (TaskHeader is a JSX host).
- Radix tooltip components (TaskHeader is a JSX host).
- Conversation content / prompts / raw memory IDs (not a semantic
  input).
- myc state (already wired on a separate seam; the selector does not
  read it).
- Session lifecycle (the selector does not read it).
- Telemetry side effects (no logging).

---

## 12. C2 — divergence classification

Per the C2 of the ACT:

> `canonical = idle`, `legacy = streaming`,
> `publicationShadowBinding = UNBOUND`

Trace through the production selector:

- branch 1 (`compacting`)?  No — `currentLegacyPhase = "streaming"`.
- branch 2 (`awaiting_followup`)?  No.
- branch 3 (shadow)?
    - `canonicalShadowPhase !== undefined`  →  Yes ("idle")
    - `isShadowStale = (canonicalShadowObservedTurnSeq !== undefined) && (seq > canonicalShadowObservedTurnSeq)`
      → in the UNBOUND scenario, `canonicalShadowObservedTurnSeq === undefined`
      → `isShadowStale = false`
    - `isUnboundDemotingActiveToTerminal =
         (canonicalShadowObservedTurnSeq === undefined)
         && isTerminalShadowPhase("idle")
         && isActiveLegacyPhase("streaming")`
      → `undefined === undefined` → `true`
      → `isTerminalShadowPhase("idle")` → `true`
      → `isActiveLegacyPhase("streaming")` → `true`
      → `isUnboundDemotingActiveToTerminal = true`
    - `!isShadowStale && !isUnboundDemotingActiveToTerminal`
      → `true && false` → `false`
- branch 4 (legacy) fires:
    → `{ phase: "streaming", source: "legacy", seq }`

This matches the known production evidence (`currentLegacyPhase =
streaming`, presentation phase = "streaming", source = "legacy"). The
contract IS provable. **Classification: A — contract is provable.** No
binding-repair or contract-halt classification is needed.

---

## 13. Frozen contract (C1 of the ACT)

```text
Inputs (semantic facts only):
  canonicalShadowPhase          : TurnPhase | MISSING
  currentLegacyPhase            : TurnPhase
  seq                           : number  (TurnState-domain monotonic)
  canonicalShadowObservedTurnSeq: number | MISSING  (TurnState-domain stamp)

Output (presentation semantics):
  phase  : TurnPhase
  source : "host" | "shadow" | "legacy"
  seq    : number  (verbatim passthrough of input.seq)

Rules:
  R1 (HOST COMPACTION):
    currentLegacyPhase == "compacting"
      => { phase = "compacting", source = "host" }
  R2 (HOST AWAITING_FOLLOWUP):
    currentLegacyPhase == "awaiting_followup"
      => { phase = "awaiting_followup", source = "host" }
  R3 (CANONICAL SHADOW):
    canonicalShadowPhase != MISSING
    AND NOT stale(...)
    AND NOT unbound_demote(...)
      => { phase = canonicalShadowPhase, source = "shadow" }
  R4 (LEGACY ABSENCE):
    else
      => { phase = currentLegacyPhase, source = "legacy" }

Auxiliary predicates (closed):
  terminalShadowPhase p =
    p == "idle" OR p == "completed" OR p == "error" OR p == "resumable"
  activeLegacyPhase p =
    p == "streaming" OR p == "awaiting_approval"
  stale = (canonicalShadowObservedTurnSeq != MISSING)
          AND (seq > canonicalShadowObservedTurnSeq)
  unbound_demote =
    (canonicalShadowObservedTurnSeq == MISSING)
    AND terminalShadowPhase canonicalShadowPhase
    AND activeLegacyPhase currentLegacyPhase
```

The Elm kernel expresses this frozen contract. The TS production selector
remains authoritative (C2 A classification: contract provable); Elm is
**differential only**.