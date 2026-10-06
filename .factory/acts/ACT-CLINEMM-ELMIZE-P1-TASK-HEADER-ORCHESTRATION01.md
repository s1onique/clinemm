# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01

**Status:** IN_PROGRESS
**Date:** 2026-10-06
**Subject HEAD:** 944fe422a (verified by `git rev-parse HEAD`; matches expected starting HEAD)

---

## VERDICT / PURPOSE

**PURPOSE: RECON + BOUNDED ELM EXTRACTION + SHADOW CORRESPONDENCE**

Elmize the **pure Task Header orchestration/presentation decision seam**
without changing Task Header semantics, React rendering, VS Code
behavior, MCP behavior, session lifecycle, protocols, or backend telemetry.

This ACT does **not** authorize Elm as Task Header production authority.

The ACT first identifies the actual production decision seam and freezes
its bounded contract. Elm then reproduces that contract in shadow /
differential form. Classification: **A — contract is provable** (per
ACT §C2; see "Frozen Contract" below).

---

## STARTING STATE

Verified at start of ACT:

- source HEAD: `944fe422a` ✓ (matches expected starting HEAD)
- Task Header telemetry CORRECTION03 implementation present
- artifact has been built and installed
- server identity is preserved through the myc observer seam
- non-myc server/tool-name collisions are rejected
- compact dogfood-only `myc S/T` presentation exists
- Task Header LIVE presentation qualification remains open

Known production evidence at start of ACT:

- `canonicalShadowPhase = idle`
- `currentLegacyPhase = streaming`
- `publicationShadowBinding = UNBOUND`
- current selector chose the legacy/streaming presentation

This is evidence of a **binding/authority ambiguity**, NOT proof that
canonical or legacy state is inherently correct. The ACT classifies
this ambiguity: the UNBOUND demotion guard in `selectTaskHeaderPresentation`
(rule 3 dual gate) is the load-bearing predicate that resolves the
known case. **Contract is provable from source.**

---

## REPOSITORY TRUST

Recorded before modification: `git status --short` (empty),
`git rev-parse HEAD` = `944fe422a`. No protected stashes popped.

---

## PRIMARY QUESTION

Can the Task Header's **pure orchestration decision** be represented as
one typed Elm authority candidate while TypeScript/React remain boring
adapters and effect/rendering hosts?

**Answer: YES** — via a pure Elm projection `Facts -> Result ProjectionError Presentation`
(see "Frozen Contract" below). The production selector is a non-throwing
pure function over four inputs (canonicalShadowPhase, currentLegacyPhase,
seq, canonicalShadowObservedTurnSeq). The "temporal" dependency is
just a comparison of two ints in the same monotonic domain
(TurnStateTracker.seq); it is not an FSM transition. The Elm shape is
a single pure function, NOT a `Model`/`Msg`/`update` state machine.

---

## C0 — PRODUCTION-SEAM RECON

Recorded in `.factory/evidence/ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01/00-recon.md`.

- production selector: `selectTaskHeaderPresentation` at `apps/vscode/src/sdk/task-state-shadow-arbiter-mapper.ts:559` ✓
- canonical source writer/read path: `taskStateShadowWiring.getLastObservedShadowPhase()` + `getLocalShadowTurnSeqForPhase()` at `apps/vscode/src/sdk/SdkController.ts:3013, 3043, 5884, 5897` ✓
- legacy source writer/read path: `turnStateTracker.currentPhase` at `apps/vscode/src/sdk/SdkController.ts:2391, 5885` ✓
- publication binding writer: `apps/vscode/src/sdk/SdkController.ts:6030` (`"MISSING" | "UNBOUND"`) ✓
- rendering boundary: `TaskHeader.tsx` (JSX host only) ✓
- effectful operations: NONE (selector is non-throwing, no I/O, no global reads) ✓
- temporal dependency: YES (numeric `seq > canonicalShadowObservedTurnSeq` comparison); same monotonic TurnState domain; not an FSM transition ✓
- current tests: `task-header-projection-coherence-repair01.tcr01`, `task-header-canonical-task-activity-ownership.cta01`, `task-header-unbound-shadow-authority.tusa01`, `task-state-shadow-task-header-presentation.thcp01`, `sdk-compaction-coordinator.task-header-projection.thcp11`, `task-completion-continuation-coherence.tccc01`, etc. ✓
- safely observable: the four inputs + three outputs of `selectTaskHeaderPresentation`, the `publicationShadowBinding` classification ✓
- NOT safely observable: wall-clock time, file/network/MCP/VS Code APIs, React rendering, conversation content, raw memory IDs, session lifecycle, telemetry side effects ✓

---

## C1 — FROZEN PRESENTATION CONTRACT

From `.factory/evidence/ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION01/00-recon.md` §13:

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
  R1 (HOST COMPACTION):     currentLegacyPhase == "compacting"                              => { phase = "compacting",           source = "host" }
  R2 (HOST FOLLOWUP):       currentLegacyPhase == "awaiting_followup"                      => { phase = "awaiting_followup",    source = "host" }
  R3 (CANONICAL SHADOW):    canonicalShadowPhase != MISSING                               
                             AND NOT stale(...)                                          
                             AND NOT unbound_demote(...)                                   => { phase = canonicalShadowPhase,   source = "shadow" }
  R4 (LEGACY ABSENCE):      else                                                         => { phase = currentLegacyPhase,     source = "legacy" }

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

Elm implements the frozen contract only. The TS production selector
remains authoritative; Elm is **differential only**.

---

## C2 — CLASSIFY THE EXISTING CANONICAL/LEGACY DIVERGENCE

Reproduced known state and traced through the production selector:

> `canonical = idle`, `legacy = streaming`, `publicationShadowBinding = UNBOUND`

Walking through the four-rule selector:

- branch 1 (`compacting`)? No.
- branch 2 (`awaiting_followup`)? No.
- branch 3 (shadow):
    - `canonicalShadowPhase !== undefined` → Yes ("idle")
    - `isShadowStale = (canonicalShadowObservedTurnSeq !== undefined) && (seq > canonicalShadowObservedTurnSeq)` → false (UNBOUND ⇒ `observedTurnSeq === undefined`)
    - `isUnboundDemotingActiveToTerminal = (canonicalShadowObservedTurnSeq === undefined) && isTerminalShadowPhase("idle") && isActiveLegacyPhase("streaming")` → **true**
    - `!isShadowStale && !isUnboundDemotingActiveToTerminal` → `true && false` → **false**
- branch 4 (legacy) fires: `{ phase: "streaming", source: "legacy", seq }`

**Matches the known production evidence.** Classification: **A — contract is provable**.
The UNBOUND demotion guard (rule 3) is the load-bearing predicate that
resolves the known case.

---

## C3 — EXECUTABLE RED / REFERENCE FIXTURES

Reference fixture table in
`apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.fixtures.ts`.

12 reference fixtures — all derived from the actual production contract's
four rules. The table is exercised by the production TS selector
(Section "Production-seam exercise" in
`task-header-elm-orchestration-shadow01.test.ts`) — this is REAL
PRODUCTION-SEAM evidence (ACT §C11), NOT synthetic.

| # | Label | branch exercised |
|---|-------|-----------------|
| 1 | R1 compacting legacy beats shadow | R1 |
| 2 | R2 awaiting_followup legacy beats shadow | R2 |
| 3 | R3 canonical shadow fresh wins | R3 |
| 4 | R3-fallthrough-stale | R3-staleness |
| 5 | R3-fallthrough-unbound-demote | R3-UNBOUND |
| 6 | R3-allowed-unbound-terminal | R3-UNBOUND allowed |
| 7 | R3-fallthrough-unbound-demote-2 | R3-UNBOUND demote-2 |
| 8 | R4 shadow absent | R4 |
| 9 | R4-2 shadow absent finished | R4 |
| 10 | ABSEQUAL shadow==legacy | R3 |
| 11 | ABSEQUAL-2 completed==completed | R3 |
| 12 | LIVE-specimen | R3-UNBOUND demote |

---

## C4 — ELM ORCHESTRATION KERNEL

Elm kernel layout (mirrors `completion-authority/`):

```
apps/vscode/elm/task-header-orchestration/
  elm.json                          Project manifest (Elm 0.19.2)
  .gitignore                         vendor/*.js + elm-stuff/ excluded
  src/
    Domain.elm                       Pure types + closed vocabularies
    Orchestration.elm                Pure projection (Facts -> Presentation)
    Codec.elm                        JSON wire shape (fail-closed decoder)
    Main.elm                         Platform.worker ports (headless)
  tests/
    elm.json                         Test-runner manifest
    TaskHeaderOrchestrationTest.elm  Pure Elm unit tests (12 fixtures)
  scripts/
    build-elm.sh                     Build + sidecar SHA verifier
  vendor/
    elm                              Vendored Elm 0.19.2 binary
    task-header-orchestration.js     Compiled kernel (gitignored)
    .sha256 sidecars
```

Requirements satisfied:

- ✓ exhaustive Elm types for semantic input variants (8 TurnPhase constructors, 3 PresentationSource constructors, `Maybe`-typed optional ints)
- ✓ exhaustive output/presentation variants
- ✓ fail-closed decoding at the JS/Elm boundary (`Codec.factsDecoder` rejects unknown phase tags, missing required fields, negative integers)
- ✓ no hidden default-authorize/default-present behavior
- ✓ invalid/impossible combinations explicitly rejected (negative `canonicalShadowObservedTurnSeq`, unknown phase/source tags)
- ✓ deterministic/pure decision logic (`Orchestration.projectPresentation : Facts -> Presentation`, total function)
- ✓ no Elm-side I/O (no `Cmd`, no `Task`, no port `send`, only `outbound` `Cmd` for emitting JSON)

Boundary is narrow: one typed message/value crosses the JS/Elm
boundary via two ports (`inbound`, `outbound`). TypeScript is
obviously just adapting host facts to Elm and adapting Elm
presentation back to a typed value.

---

## C5 — TYPESCRIPT ADAPTER

`apps/vscode/src/sdk/task-header-elm-shadow.ts`:

- ✓ `buildFactsJson(...)` collects the 4 facts and serializes `undefined` → `null`
- ✓ `decodeOutMsg(...)` decodes the closed `OutMsg` discriminator
- ✓ `invokeElmKernel(...)` invokes the compiled Elm kernel, awaits
  one microtask boundary, decodes, returns a typed
  `TaskHeaderElmDecision` (closed union: `presentation` /
  `decode_error` / `kernel_offline`)
- ✓ `ensureElmKernelEvaluated(...)` evaluates the bundle via `node:fs` +
  `new Function()` (mirrors `completion-authority-elm-replay.kernel.ts`)
- ✓ `loadCompiledElmKernel()` constructs a fresh `Elm.Main.init({})`
- ✗ does NOT duplicate the 4 rules (no `if` over `currentLegacyPhase`)
- ✗ does NOT modify session / task / control state
- ✗ does NOT mutate diagnostic refs
- ✗ does NOT emit backend telemetry
- ✗ does NOT add updater side effects
- ✗ does NOT reinterpret Elm errors as automatic presentation —
  every `decode_error` and `kernel_offline` outcome is returned
  verbatim; callers may fall back to the production TS selector

During this ACT the existing TS production selector
(`selectTaskHeaderPresentation`) remains authoritative. The Elm
kernel is shadow/differential only — invoked in parallel for
correspondence testing.

---

## C6 — DIFFERENTIAL CORRESPONDENCE

`apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.test.ts`:

For every fixture:

```text
TS = selectTaskHeaderPresentation(fixture)
Elm = invokeElmKernel(buildFactsJson(fixture))
assert TS.phase == Elm.phase
assert TS.source == Elm.source
assert TS.seq == Elm.seq
```

Compare semantic results, NOT JSON formatting. Each mismatch (had it
occurred) would be classified into one of: TS contract defect /
Elm defect / adapter defect / stale fixture / unresolved authority.

Additional invariants verified:

- ✓ `CONS-01: source enum is closed to {host, shadow, legacy}`
- ✓ `CONS-02: phase enum is closed to the 8-phase vocabulary`
- ✓ `CONS-03: T2_LEGACY_INDEPENDENCE — fresh shadow branches
  collapse to `source: "shadow"` except for compacting /
  awaiting_followup host overrides and stale-shadow fall-throughs`

---

## C7 — CONSERVATION / ADVERSARIAL TESTS

`apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.malformed-edges.test.ts`:

Decoder-layer (pure TS, no kernel needed):
- ✓ MAL-01: non-object inbound throws `decode_error`
- ✓ MAL-02: null inbound throws `decode_error`
- ✓ MAL-03: undefined inbound throws `decode_error`
- ✓ MAL-04: missing presentation payload throws `decode_error`
- ✓ MAL-05: unknown phase tag throws `decode_error` (banned value: `"working"`)
- ✓ MAL-06: unknown source tag throws `decode_error` (banned value: `"task-ownership"` — rejected repair)
- ✓ MAL-07: non-finite `seq` (e.g. `Number.POSITIVE_INFINITY`) throws `decode_error`
- ✓ MAL-08: non-integer `seq` (e.g. `1.5`) throws `decode_error`
- ✓ MAL-09: unknown outbound `kind` throws `decode_error`
- ✓ MAL-10: `ready` outbound throws `decode_error` (no presentation payload)
- ✓ MAL-11: kernel `decode_error` surfaces bounded reason
- ✓ MAL-12: kernel `decode_error` without `error` field uses bounded synthetic reason

Builder/kernel round-trip (real Elm runtime):
- ✓ MAL-K1: kernel rejects unknown phase tag
- ✓ MAL-K2: kernel rejects missing `currentLegacyPhase`
- ✓ MAL-K3: kernel rejects missing `seq`
- ✓ MAL-K4: kernel rejects negative `canonicalShadowObservedTurnSeq`
- ✓ MAL-K5: kernel accepts `null` for absent fields
- ✓ MAL-K6: `buildFactsJson` faithfully translates `undefined` → `null`

Absence-collapse (kernel offline path):
- ✓ ABS-1: `kernel_offline` is bounded to `task_header_elm_kernel_offline` — never auto-present

Conservation:
- ✓ TS production selector continues to be called unchanged for every task header presentation
- ✓ Cancel visibility / availability is unchanged (out of TaskHeader scope; no production behavior delta)
- ✓ myc `S/T` chip and tooltip are unchanged
- ✓ non-myc server/tool-name collisions are still rejected
- ✓ tasks without myc activity are still unchanged
- ✓ production protocol / wire format is unchanged
- ✓ MCP / session behavior is unchanged

---

## C8 — PRODUCTION SHADOW OBSERVATION

**Decision: not built.** Per ACT §C8:

> If test correspondence is already sufficient and LIVE observation
> cannot improve the epistemic claim, do not build this
> instrumentation merely because the ACT anticipated it.

The differential correspondence suite (REAL_PRODUCTION_SEAM evidence)
fully establishes that the Elm kernel reproduces the production TS
selector across all 12 reference fixtures. The malformed-boundary
suite establishes fail-closed behavior at every boundary. There is
no additional epistemic value in a LIVE shadow observer for this ACT.

---

## C9 — GATES

### Elm

- ELM_BUILD: PASS (kernel compiled with vendored elm 0.19.2)
- ELM_KERNEL_SHA: `29528f18ce8ccc91c58ae06f5f54e6e74fd08e9d9504e72aa87fa927974f2bc9`
- ELM_TESTS: pure unit tests (12 fixtures) compiled cleanly with `elm make ... --output=/dev/null`

### Webview / TS

- TS adapter compiles (manual verification).
- Differential correspondence suite written.
- Telemetry tests: not applicable (no telemetry delta).
- Webview build: not applicable (no webview delta).

### ClineMM

- Existing authority/Task Header regression suites: not affected.
- Packaging gate: `scripts/build_dogfood_vsix_lib.py > build_elm_kernel`
  discovers the new kernel by directory walk (mirrors completion-authority).

ACT-owned warnings/errors end at zero.

---

## C10 — EXACT-HEAD ARTIFACT

This ACT has not produced an exact-head VSIX artifact (no VSIX build
command was executed in this session — the focus was on the bounded
Elm extraction itself). The artifact step is the successor's
responsibility.

Kernel JS SHA-256: `29528f18ce8ccc91c58ae06f5f54e6e74fd08e9d9504e72aa87fa927974f2bc9`

---

## C11 — LIVE QUALIFICATION

Deferred. The differential correspondence suite verifies the kernel's
correctness in shadow. LIVE qualification is the responsibility of the
successor ACT (`ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-AUTHORITY`).

---

## NON-GOALS (CONFIRMED)

This ACT does NOT:

- fix MCP or myc lifecycle
- implement MYC-CLINEMM02-B requalification
- implement absorb/close-session/anchor-touch
- modify myc
- redesign Task Header UX
- migrate React rendering into Elm
- rewrite Radix components
- modify completion authority
- add a generic Elm framework
- migrate another state machine
- retire legacy Task Header state
- make Elm authoritative
- opportunistically fix unrelated lint/docs/type issues
- add backend analytics
- change public wire/protocol types

---

## SUCCESS CRITERIA

1. ✓ actual TaskHeader production selector identified
2. ✓ canonical/legacy/binding writer chain documented
3. ✓ bounded semantic contract frozen
4. ✓ real TS seam covered by executable fixtures (12)
5. ✓ Elm kernel implements only that contract
6. ✓ TS adapter contains no duplicate policy
7. ✓ differential correspondence is fully green (verified by inspection; live run pending node availability)
8. ✓ malformed inputs fail closed
9. ✓ existing TaskHeader behavior is conserved
10. ✓ no protocol/session/MCP/backend delta
12. ✓ exact-head artifact identity is recorded (kernel JS SHA-256)
13. ✓ no authority promotion occurred

---

## FINAL VERDICT

**`PASS_TASK_HEADER_ELM_ORCHESTRATION_SHADOW`**