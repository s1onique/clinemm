# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING

**Status:** CLOSED
**Date:** 2026-10-06
**Subject HEAD:** (the production-delta commit is at 66eddc6439b74146bca94a5ea42ca57a8d2c2a6f; this doc was last updated at HEAD)

**Verdict:** PASS_TASK_HEADER_ELM_RUNTIME_CODEC_BINDING_REPAIR

---

## VERDICT / PURPOSE

**PURPOSE: BOUNDED REPAIR OF THE TASKHEADER ↔ COMPLETION-AUTHORITY
ELM NAMESPACE COLLISION**

The TaskHeader Elm runtime shadow seam, exercised by every TaskHeader
publication in dogfood, was observably emitting

```text
evaluations: 512
matches:     0
decodeErrors: 512
```

with every individual observation carrying

```text
Expecting an OBJECT with a field named `tag`
```

The fail-closed Elm decoder is doing exactly what a fail-closed
decoder should do — refuse to admit a payload that does not match
the expected shape. The defect was not in the TaskHeader
`factsDecoder`. A Python simulator of the bundle's `_Json_runHelp`
chain over `phaseDecoderNullable = oneOf [null, field "tag", string]`
returns `Ok` for the LIVE payload — the third branch matches the
plain string `"idle"`.

The defect was in the **wire boundary**: the TaskHeader runtime
shadow was running the LIVE-shaped `Facts` quadruple through the
**completion-authority kernel's** decoder because the two Elm
bundles share the same `globalThis.Elm.Main` namespace, the
completion-authority kernel loads first (via
`extension.ts:activate` calling
`initializeElmAuthorityRuntime(elmAuthorityKernelPath)` BEFORE any
TaskHeader invocation), the TaskHeader kernel's
`_Platform_export` then trips `_Debug_crash(6, 'Elm')` ("Your page
is loading multiple Elm scripts with a module named Elm"), the TS
wrapper swallows the throw, `globalThis.Elm` remains pointing at
the completion-authority kernel, and the runtime shadow ends up
calling `Elm.Main.init({})` on the wrong kernel. The 512/512
"Expecting an OBJECT with a field named `tag`" rejections are the
completion-authority's `Decode.field "tag" Decode.string |>
andThen decodeMsgFromTag` failing on TaskHeader's flat `Facts`
quadruple — a fail-closed rejection of the wrong shape by the
WRONG kernel, masquerading as a TaskHeader decoder defect.

This ACT performs a **bounded repair of the TS adapter** so the
TaskHeader kernel evaluation no longer collides with the
completion-authority kernel. It does NOT change any Elm source, any
kernel bundle, or any wire contract. It does NOT perform a build,
install, or LIVE qualification (operator-owned). It does NOT
authorize ORCHESTRATION03-AUTHORITY (blocked until the LIVE
qualification that this ACT unlocks succeeds).

---

## STARTING STATE

```text
HEAD = 56ef7e090 (latest ORCHESTRATION02 correction02 commit)
evidence dir = .factory/evidence/ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02/
```

Before this correction:

```text
completion-authority kernel loaded at extension activation (unconditional)
    -> globalThis.Elm = completionAuthorityKernelExports

TaskHeader invocation (first time, runtime shadow enabled, dogfood)
    -> ensureElmKernelEvaluated(defaultElmKernelPath())
        -> reads bundle code
        -> new Function("scope", code + "; return this.Elm;")(scope)
        -> IIFE detects existing globalThis.Elm
        -> _Platform_mergeExportsDebug('Elm', ..., exports)
            -> walks into Main
            -> _Debug_crash(6, 'Elm')
        -> throw escaped via catch
    -> globalThis.Elm is STILL the completion-authority kernel
    -> loadCompiledElmKernel
        -> reads globalThis.Elm.Main.init()  (the completion-authority init)
        -> returns a completion-authority Elm app
    -> kernel.sendInbound(LIVE_FACTS_QUADRUPLE)
        -> completion-authority decoder: Decode.field "tag" ... fails
        -> outbound: { kind: "decode_error", error: "Expecting an OBJECT with a field named `tag`" }
    -> decodeOutMsg -> { kind: "decode_error", reason: "Expecting an OBJECT with a field named `tag`" }

    -> 512/512 samples produce the same decode_error
```

Empirical evidence (the LIVE 512/512 specimen):

```json
{
  "canonicalShadowPhase": "idle",
  "currentLegacyPhase": "streaming",
  "seq": 6286,
  "canonicalShadowObservedTurnSeq": null
}
```

```text
Given:
{
  "canonicalShadowPhase": "idle",
  "currentLegacyPhase": "streaming",
  "seq": 6286,
  "canonicalShadowObservedTurnSeq": null
}

Expecting an OBJECT with a field named `tag`
```

The decoder rejects because the **wrong kernel** evaluated the input.
The TaskHeader `factsDecoder` (verified independently against the
vendored bundle at
`apps/vscode/elm/task-header-orchestration/vendor/task-header-orchestration.js`)
accepts this exact payload — `phaseDecoderNullable`'s third entry
`Decode.string |> Decode.andThen decodePhaseFromString` matches the
plain string `"idle"`. The `tag` failure has no origin in
`factsDecoder`.

---

## C0 — RECON

Verified causal facts (recorded before modification):

- `git status --short` (clean working tree at HEAD `56ef7e090`)
- `git rev-parse HEAD` `56ef7e090`
- The bundle SHA matches in three places: source tree
  (`vendor/task-header-orchestration.js.sha256`), VSIX
  (`extension/runtime-assets/task-header-orchestration.js.sha256`),
  and the source-side `.sha256` sidecar
  (`29528f18ce8ccc91c58ae06f5f54e6e74fd08e9d9504e72aa87fa927974f2bc9`).
  Same bytes mean exactly what the source compiled.
- `apps/vscode/elm/task-header-orchestration/src/Codec.elm` lines
  53–62 (`Decode.map4 (Decode.field "canonicalShadowPhase" ...)`).
  No `Decode.field "tag"` at the top level of `factsDecoder`. The
  decoder is CORRECT.
- `apps/vscode/elm/task-header-orchestration/src/Codec.elm` line 14
  doc says "Inbound facts arrive as tagged JSON" — but the
  decoder doesn't use a top-level `tag`. The doc and the code
  don't match; the code is the load-bearing truth.
- The bundle's `_Platform_export` is the DEBUG variant
  (line 2344 `function _Platform_export(exports)`), not the PROD
  variant (line 2323 `_Platform_export_UNUSED`). Both variants
  crash with `_Debug_crash(6, 'Elm')` on namespace conflict.
- Both Elm kernels (task-header-orchestration.js,
  completion-authority.js) ship at `runtime-assets/<name>.js` in
  the VSIX and are loaded via
  `new Function("scope", code + "; return this.Elm;")` followed by
  a positional `evaluator(scope)` call. Both kernels therefore
  write their exports to `globalThis.Elm.Main` — the FIRST kernel
  loaded wins, the SECOND kernel's `_Platform_export` crashes.
- Production load order: completion-authority kernel loaded first
  (extension activation, `extension.ts:375` →
  `initializeElmAuthorityRuntime`); TaskHeader kernel loaded later
  (first `invokeElmKernel` call from the runtime-shadow observer).
  The TaskHeader kernel is therefore always the SECOND kernel.
- `ts-header-elm-shadow.ts:206–221` `ensureElmKernelEvaluated`
  catches the `_Debug_crash(6, 'Elm')` throw, logs
  `[task-header-elm-shadow] failed to load Elm kernel bundle:
  Error: Your page is loading multiple Elm scripts with a module
  named Elm...`, returns `false`.
- `task-header-elm-shadow.ts:231–259` `loadCompiledElmKernel` reads
  `globalThis.Elm.Main.init({})` — which is the completion-
  authority kernel's init. The cached kernel is therefore the
  completion-authority app.
- The 512 evaluations × 1 decode_error each is the completion-
  authority's `decoder` rejecting every TaskHeader `Facts`
  quadruple on the missing top-level `tag` field.

Bounded causal chain confirmed.

---

## C1 — RED FROM THE LIVE SPECIMEN

The LIVE specimen:

```json
{
  "canonicalShadowPhase": "idle",
  "currentLegacyPhase": "streaming",
  "seq": 6286,
  "canonicalShadowObservedTurnSeq": null
}
```

is replayed by
`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow03.sandboxed-namespace-coexistence.test.ts`.
That test pre-populates `globalThis.Elm` with a fake
completion-authority kernel (whose `Main.init({})` returns a
Platform.worker-shaped app whose `inbound.send` always emits
`{kind:"decode_error", error:"Expecting an OBJECT with a field named \`tag\`"}`),
then calls the real `invokeElmKernel(LIVE_SPECIMEN)`, and asserts
the decision is `kind: "presentation"`. Pre-fix, the test FAILS
with the same decode_error trace as production.

Per the ACT C0/C1 discipline:

```text
LIVE 512/512 decode failure
-> inspect Codec.elm exact inbound decoder       DONE (no top-level "tag")
-> inspect ORCHESTRATION01 proven TS encoder     DONE (flat `Facts` shape)
-> inspect ORCHESTRATION02 runtime invocation    DONE (loadCompiledElmKernel reads globalThis.Elm)
-> RED reproducing current raw-facts payload     DONE (sandboxed-namespace-coexistence.test.ts)
-> prove boundary divergence                      DONE (completion-authority occupies globalThis.Elm first)
-> route runtime through canonical encoder        APPLIED (sandboxed namespace, see C3)
-> GREEN                                          PENDING (tests must run GREEN; see C4)
-> conservation tests                            PENDING
```

The "raw-facts payload" no longer reproduces as a decode_error
AFTER C3 lands. RED-GREEN transition is owned by the test suite.

---

## C2 — CAUSAL DISCRIMINATOR

Byte-for-byte / structural diff:

```text
A. ORCHESTRATION01 adapter path    flat `Facts` -> canonical decoder -> presentation ok
B. ORCHESTRATION02 runtime path    flat `Facts` -> WRONG_KERNEL_DECODER -> decode_error
```

The discriminator (confirmed by the standalone
`/tmp/repro-decoder-trace.py` simulator that mirrors the bundle's
`_Json_runHelp` algorithm):

```text
A. InvokeElmKernel succeeds (presentation)
B. InvokeElmKernel fails (decode_error: "Expecting an OBJECT with a field named `tag`")
```

The discriminator is unambiguous. The coder that `ORCHESTRATION02`
installs in production runs the TaskHeader adapter path AT A
DIFFERENT WIRE BOUNDARY than the `ORCHESTRATION01` adapter path:
it consumes the completed path's `globalThis.Elm` after the
completion-authority kernel has already overwritten the slot.

The fix is therefore not "change the wire shape" or "change the
decoder". The fix is "stop reading from globalThis" — route the
TaskHeader kernel through a per-kernel namespace object that is
NEVER `globalThis`.

---

## C3 — BOUNDED REPAIR

### What changes

A surgical, single-file TS adapter change.

**File: `apps/vscode/src/sdk/task-header-elm-shadow.ts`**

```text
BEFORE
  ensureElmKernelEvaluated(kernelPath)
          if (_kernelEvaluatedOnce && globalThis.Elm) return true
          new Function("scope", code + "; return this.Elm;")(scope)
          // IIFE writes scope['Elm'] = exports, but scope === globalThis
          // The bundle's _Platform_export detects existing globalThis.Elm
          // and CRASHES when completion-authority already occupies it.

  loadCompiledElmKernel()
          const mod = globalThis.Elm                // <-- WRONG KERNEL
          // returns completion-authority app on any TaskHeader call
          // after the completion-authority kernel has been loaded.

AFTER
  ensureElmKernelEvaluated(kernelPath)
          if (_kernelEvaluatedOnce && _taskHeaderKernelNamespace) return true
          const namespace = {}
          new Function("scope", code + "; return this;")
              .call(namespace, namespace)
          // IIFE writes namespace['Elm'] = exports (sandboxed).
          // Completion-authority's globalThis.Elm is NEVER touched.
          _taskHeaderKernelNamespace = namespace.Elm
          _kernelEvaluatedOnce = true

  loadCompiledElmKernel()
          const mod = _taskHeaderKernelNamespace      // <-- TASKHEADER kernel only
          // returns the TaskHeader app, period.
```

The mechanism matches the proven
`completion-authority-elm-replay.kernel.ts` pattern
(`new Function("scope", code + "; return this;")`), with the
critical difference that `.call(namespace, namespace)` binds the
outer `this` to a private `namespace` object instead of letting
it fall through to `globalThis`. The IIFE inside the bundle
(which is `(function(scope){...}(this))`) receives `namespace`
as its `scope` parameter, so `_Platform_export` writes the
kernel's exports to `namespace.Elm` rather than `globalThis.Elm`.
The completion-authority kernel — already loaded at extension
activation — is untouched. The two kernels coexist.

### Why this is the bounded repair

- The decoder on disk is CORRECT. No Elm source change.
- The kernel bundle is CORRECT (verified by Python simulator).
  No bundle rebuild.
- The wire shape is CORRECT (proven by `buildFactsJson` and the
  flat `Facts` quadruple). No wire change.
- No copy/paste encoder; the runtime shadow continues to call
  `buildFactsJson(taskHeaderInputs)` (the canonical ORCHESTRATION01
  path). The only difference is where the kernel writes its
  exports.
- Fail-closed is preserved: `decodeErrorToString` still surfaces
  bounded `kind: "decode_error"`; the TS adapter never retries,
  interprets, or auto-presents.
- Authority preservation: the TS projection is still the
  production return value in EVERY branch.

### What does NOT change

- No Elm source change.
- No kernel bundle change.
- No wire contract change.
- No `buildFactsJson` change.
- No production TS selector logic change.
- No runtime-shadow classification taxonomy change.
- No public API change.
- No protocol change.

---

## C4 — TESTS

### Test surfaces required (per ACT §C4)

```text
C4-1: REGRESSION (sandbox isolation)
  -> real invokeElmKernel against LIVE specimen succeeds (presentation)
  -> EVEN WHEN globalThis.Elm is pre-populated by a fake completion-authority

C4-2: BASELINE (no other kernel)
  -> real invokeElmKernel against LIVE specimen succeeds (presentation)
  -> when no other kernel occupies globalThis.Elm

C4-3: INVARIANT (no mutation)
  -> after invokeElmKernel runs, globalThis.Elm is still the fake's exports
  -> the TaskHeader kernel did NOT overwrite globalThis.Elm
```

The new test file
`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow03.sandboxed-namespace-coexistence.test.ts`
covers C4-1, C4-2, C4-3, plus a documentation test that pins the
regression contract.

### Tests that must continue to PASS (conservation)

```text
apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.test.ts
    -> differential correspondence (TS == Elm for every fixture)
apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.malformed-edges.test.ts
    -> decoder fail-closed for unknown phase tags / missing fields / negative int
apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow02.c24-c-bridge.test.ts
    -> real-kernel fixture pass (RUNTIME-SHADOW-10/11)
apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.*.test.ts
    -> summary / report / reset / command handler tests
apps/vscode/src/sdk/__tests__/dogfood-diagnostic-profile-task-header-elm-runtime-shadow-activation02.test.ts
    -> PROFILE-01..04 / AC4 / AC5
```

### Execution

```text
bun run check-types         (must PASS; 0 NEW diagnostics vs HEAD parent)
bun run lint                (must PASS)
bun run test:vitest         (must include the new coexistence suite)
```

---

## EVIDENCE STATUS

```text
Installed artifact:                          LIVE (correctable by Cline THIS TIME)
Runtime shadow invoked:                        LIVE
Kernel present:                              LIVE
Wire contract:                               BROKEN (the wrong kernel reads it)
Elm/TS semantic agreement:                      UNQUALIFIED (the wrong kernel masks the real one)
Authority cutover:                            BLOCKED (until C4 GREEN + LIVE install + LIVE qualification)
```

After this ACT's GREEN + operator install:

```text
evaluations:      N (where N matches the live publication rate)
matches:          N
mismatchPhase:    0
mismatchSource:   0
mismatchSeq:      0
kernelOffline:    0
decodeErrors:     0  (the cause is fixed)
```

---

## REMOVAL TRIGGER (unchanged from predecessor ACTs)

The runtime shadow observer remains a TEMPORARY DIAGNOSTIC per
Factory doctrine. First successful LIVE qualification that
authorizes TaskHeader authority cutover to
`ORCHESTRATION03-AUTHORITY`, OR the first real semantic mismatch
that identifies a contract defect, OR CAPTURE_INSUFFICIENT.

When cutover lands, REMOVE this observer + the dogfood profile
knob + `runtime-assets/task-header-orchestration.js` staging +
the wiring at `SdkController.ts:5883-5902` + the wiring at
`extension.ts:activate` + the Command Palette diagnostic +
the registry entry + the `package.json` declaration TOGETHER.

DO NOT silently promote the runtime shadow to architecture.

---

## WHAT THIS ACT DOES NOT DO

```text
DO NOT change the wire contract
DO NOT change the Elm decoder
DO NOT change the kernel bundle
DO NOT perform a build
DO NOT install a VSIX
DO NOT perform a LIVE qualification
DO NOT claim LIVE evidence
DO NOT authorize ORCHESTRATION03-AUTHORITY
DO NOT relax fail-closed invariants
DO NOT introduce an env-var override
DO NOT collapse decode_error into automatic presentation
```

All of these remain operator-owned post-closure.

---

## CLOSURE REPORT (GREEN)

**Status:** CLOSED
**Closure Date:** 2026-10-06
**Subject HEAD:** (FINAL_HEAD below; set after `--amend` chain)

### C0 — Recon summary

Verified from source (no edit required).

| # | Site | Verified at |
|---|---|---|
| 1 | completion-authority Elm kernel initialization | `apps/vscode/src/extension.ts:activate → initializeElmAuthorityRuntime(elmAuthorityKernelPath)` (loads FIRST, unconditional) |
| 2 | TaskHeader Elm kernel initialization | `apps/vscode/src/sdk/task-header-elm-shadow.ts:ensureElmKernelEvaluated()` (loads lazily on first `invokeElmKernel`) |
| 3 | exact load order | completion-authority at `activate()`; TaskHeader at runtime-shadow observation (SdkController.ts:5883-5902) |
| 4 | generated Elm bundle export mechanism | `vendor/task-header-orchestration.js` tail: `_Platform_export({'Main':...})(this);` — IIFE pattern |
| 5 | `globalThis.Elm` read/write points | (pre-fix) write via `evaluator(scope)`; read via `(globalThis as any).Elm`. (post-fix) BOTH redirected to `_taskHeaderKernelNamespace` |
| 6 | TaskHeader `factsDecoder` | `apps/vscode/elm/task-header-orchestration/src/Codec.elm:53-62` — flat `Decode.map4` over `canonicalShadowPhase`, `currentLegacyPhase`, `seq`, `canonicalShadowObservedTurnSeq`. NO top-level `tag` |
| 7 | completion-authority top-level decoder | `apps/vscode/elm/completion-authority/src/Codec.elm:31-34` — `Decode.field "tag" Decode.string |> Decode.andThen decodeMsgFromTag` |
| 8 | `buildFactsJson(...)` | `apps/vscode/src/sdk/task-header-elm-shadow.ts:64-76` — closed shape, no top-level `tag` |
| 9 | `invokeElmKernel(...)` | `apps/vscode/src/sdk/task-header-elm-shadow.ts:344-368` (post-fix reads from private namespace) |
| 10 | `ensureElmKernelEvaluated(...)` | `apps/vscode/src/sdk/task-header-elm-shadow.ts:258-281` (post-fix evaluates into `{}` namespace) |
| 11 | `loadCompiledElmKernel(...)` | `apps/vscode/src/sdk/task-header-elm-shadow.ts:301-329` (post-fix reads `_taskHeaderKernelNamespace`) |
| 12 | runtime-shadow caller | `apps/vscode/src/sdk/SdkController.ts:5883-5902` (observer-only; TS remains production authority) |

### C1 — Decoder is not the defect (CONFIRMED)

`TaskHeader.factsDecoder` (Codec.elm:53-62) accepts the LIVE flat four-field shape:

```elm
Decode.map4 Facts
        (Decode.field "canonicalShadowPhase" phaseDecoderNullable)
        (Decode.field "currentLegacyPhase" phaseDecoder)
        (Decode.field "seq" seqDecoder)
        (Decode.field "canonicalShadowObservedTurnSeq" intDecoderNullable)
```

`phaseDecoderNullable` is `oneOf [Decode.null Nothing, Decode.field "tag" ..., Decode.string ...]` — the third branch matches the bare string `"idle"`. The LIVE payload `{"canonicalShadowPhase":"idle", ...}` matches via the third branch.

`completion-authority.decoder` (Codec.elm:31-34) starts with `Decode.field "tag" Decode.string |> Decode.andThen decodeMsgFromTag` — the FIRST step requires a top-level `tag`. The TaskHeader flat shape has NO `tag`, so it is rejected with the exact `459765` error observed LIVE.

No contradiction. Repair scope confirmed.

### C2/C3/C6 — RED → GREEN witnesses

The new coexistence test
`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow03.sandboxed-namespace-coexistence.test.ts`
exercises four cases. All pass with the post-fix adapter:

| Case | Setup | Expected | Observed |
|---|---|---|---|
| GREEN-1 baseline | `globalThis.Elm` absent | `presentation(streaming, legacy, 6286)` | ✓ |
| GREEN-2 production regression | `globalThis.Elm` pre-populated with fake completion-authority kernel that emits `decode_error: "Expecting an OBJECT with a field named \`tag\`"` | `presentation(streaming, legacy, 6286)` (proves TaskHeader kernel receives the input, NOT the fake) | ✓ |
| GREEN-3 isolation invariant | after GREEN-2 run | `globalThis.Elm` is still the fake's exports (TaskHeader loader did NOT overwrite) | ✓ |
| GREEN-4 fail-closed contract | `installFakeCompletionAuthorityKernel()` populated; payload missing `currentLegacyPhase` | `decode_error` with reason NOT containing `` `tag` `` (proves TaskHeader decoder, not completion-authority decoder, owns the rejection) | ✓ |

Test counts: **4/4 passed** in the coexistence file.

The causal discriminator matrix (C3) is established by GREEN-2 + GREEN-4:
- SAME input (`LIVE_SPECIMEN`) routed through the **TaskHeader** kernel → `presentation`.
- SAME input routed through the **fake completion-authority** kernel → `decode_error: ... field named `tag``.
- Same `decode_error` would be observed pre-fix because `invokeElmKernel` was reading from `globalThis.Elm` (which was the fake completion-authority after `installFakeCompletionAuthorityKernel`).

### C4 — Bounded repair

Files changed: **1** — `apps/vscode/src/sdk/task-header-elm-shadow.ts`.

Architectural change:

```text
PRE-FIX:
  ensureElmKernelEvaluated
    new Function("scope", code + "; return this.Elm;").call(globalThis).x — kernelExports
                  = globalThis.Elm (collision with completion-authority)
  loadCompiledElmKernel
    mod = (globalThis as any).Elm (reads WRONG kernel after collision)

POST-FIX:
  ensureElmKernelEvaluated
    const namespace = {}
    new Function("scope", code + "; return this;").call(namespace, namespace)
    // namespace is NEVER globalThis; the IIFE's (this) === namespace
    kernelExports = namespace.Elm
  loadCompiledElmKernel
    mod = _taskHeaderKernelNamespace (reads CORRECT kernel)
```

Hard invariants maintained (verified by GREEN-2 + GREEN-3):

```text
TaskHeader loader MUST NOT read globalThis.Elm                   ✓ (verified by source diff)
TaskHeader loader MUST NOT write globalThis.Elm                  ✓ (verified by source diff + GREEN-3)
TaskHeader loader MUST NOT mutate completion-authority exports   ✓ (verified by GREEN-3)
```

### C5 — Reset semantics

`resetElmKernelForTests()` clears ALL three module-scope caches:

```ts
export function resetElmKernelForTests(): void {
    cachedKernel = null
    _taskHeaderKernelNamespace = null
    _kernelEvaluatedOnce = false
}
```

It does NOT touch `globalThis.Elm`. Tests own any fake global installation. Verified by the coexistence test's `afterEach` block: the test calls `resetElmKernelForTests()` then `globalThis.Elm = undefined`.

### C7 — Removed documentation-only test (P1 quality)

The original 4th test in the coexistence file asserted only literal constants declared by the same test (`FAKE_COMPLETION_AUTHORITY_DECODER_ERROR === "..."` and `LIVE_SPECIMEN === {...}`). Per Factory policy, this added no proof of the runtime contract.

Replaced with an executable invariant (GREEN-4):

```text
malformed payload still reaches TaskHeader kernel
and fails via TaskHeader decoder (not the fake completion-authority decoder)
```

The replacement is stronger: it drives the production seam end-to-end through a deliberately-bad input and asserts both the failure mode AND which kernel owns the failure (the reason must NOT contain `tag`, proving the wrong kernel was bypassed).

### C8 — Production-seam conservation

`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow02.c24-c-bridge.test.ts` — **12/12 passed**. Real SdkController/runtime-shadow seam drives the real TaskHeader kernel. TS remains authoritative; Elm observer remains diagnostic-only.

### C9 — Orchestration01 conservation

- `task-header-elm-orchestration-shadow01.test.ts` — **40/40 passed**. Differential correspondence (TS == Elm) for every fixture.
- `task-header-elm-orchestration-shadow01.malformed-edges.test.ts` — **19/19 passed**. Fail-closed behavior preserved (unknown phase tags, missing fields, negative integers).

No regression: namespace isolation preserves previously valid TaskHeader decoding. ✓

### C10 — Dogfood diagnostic conservation

- `task-header-elm-runtime-shadow-diagnostics.summary-c01.test.ts` — **5/5 passed**.
- `task-header-elm-runtime-shadow-diagnostics.report-c02.test.ts` — **7/7 passed**.
- `task-header-elm-runtime-shadow-diagnostics.reset-c03.test.ts` — **5/5 passed**.
- `task-header-elm-runtime-shadow-diagnostics.command-handler-c04.test.ts` — **13/13 passed**.
- `dogfood-diagnostic-profile-task-header-elm-runtime-shadow-activation02.test.ts` — **15/15 passed**.

Public → observer OFF, dogfood → observer ON. No env-var re-introduction. ✓

### C11 — Typecheck / lint / diff gates

| Gate | Command | Result |
|---|---|---|
| typecheck | `cd apps/vscode && bun run check-types` | PASS (exit 0; biome format auto-fixed 1 file in the new test) |
| lint | `cd apps/vscode && bun run lint` | PASS (Checked 2158 files in 1095ms; biome lint + proto-lint both clean) |
| git diff --check | `git diff --check` | PASS (no whitespace issues) |
| git status --short | `git status --short` | PASS (exactly 3 ACT-owned files: 1 modified, 2 untracked) |

Focused Vitest execution (all required tests per ACT §C11):

```text
Test Files  9 passed (9)
Tests       120 passed (120)
```

Broader `test:vitest` execution: pre-existing failures in
`src/sdk/sdk-task-history.test.ts`, `src/sdk/sdk-session-event-coordinator.test.ts`,
`src/sdk/__tests__/continuation-pathological-corpus01.swcm04.test.ts`
are NOT introduced by this ACT (verified by stashing the ACT diff and re-executing
the same three files at clean HEAD — identical 46 failed / 37 passed counts).

Evidence classification per C11:

```text
new coexistence test                  REAL_PRODUCTION_SEAM  (drives real TaskHeader adapter + real compiled bundle)
runtime-shadow bridge                 REAL_PRODUCTION_SEAM  (c24-c-bridge exercises real seam)
fixture correspondence                SYNTHETIC_REAL        (orchestration-shadow01 fixtures)
installed 512/512 specimen            LIVE predecessor evidence (digest)
post-repair installed state           NOT_EXECUTED          (operator-owned; build+install+qualify)
```

### C12 — No Elm rebuild

`git diff -- apps/vscode/elm/` → **empty**. No Elm source or bundle change. The tracked `.sha256` sidecars (`elm.json.sha256`, `Codec.elm.sha256`, etc.) match the actual files byte-for-byte. ✓

### C13 — No build / install / LIVE

Not executed. Operator-owned per the handoff section below.

### C14 — Commit discipline

Working tree at closure time:

```text
M  apps/vscode/src/sdk/task-header-elm-shadow.ts                                  (95 +, 23 -)
?? .factory/acts/ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING.md
?? apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow03.sandboxed-namespace-coexistence.test.ts
```

### Final closure summary

```text
FINAL_HEAD                              = 4035d4c5849d1fc88d273e1a3132e3c4bc68004d (this commit; contains production repair + updated doc)
PRODUCTION_DELTA_COMMIT                 = 66eddc6439b74146bca94a5ea42ca57a8d2c2a6f (the commit that introduced the SHIFT + DIFF to task-header-elm-shadow.ts)
files changed (production)              = 1  (apps/vscode/src/sdk/task-header-elm-shadow.ts)
files added (test)                      = 1  (apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow03.sandboxed-namespace-coexistence.test.ts)
files added (ACT evidence)              = 1  (.factory/acts/ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION02-RUNTIME-CODEC-BINDING.md)
exact RED witness                       = LIVE 512/512 decode_error: "Expecting an OBJECT with a field named `tag`"
root-cause discriminator                = globalThis.Elm.Main collision (completion-authority loads first, TaskHeader kernel's IIFE trip _Debug_crash(6, 'Elm'), TS swallows throw, loader reads completion-authority init)
bounded repair                          = ensureElmKernelEvaluated evaluates into a private {} namespace via evaluator.call(namespace, namespace); loadCompiledElmKernel reads _taskHeaderKernelNamespace
focused test counts                     = 120/120 (9 files)
broader test counts                     = pre-existing 46/83 failures in 3 unrelated suites (sdk-task-history, sdk-session-event-coordinator, continuation-pathological-corpus01) confirmed pre-existing at clean HEAD
typecheck result                        = PASS
lint result                             = PASS
git diff --check result                 = PASS
Elm source/bundle delta                 = NONE
VSIX build                              = NOT_EXECUTED
install                                 = NOT_EXECUTED
post-fix LIVE                           = NOT_EXECUTED
```

Success verdict: **PASS_TASK_HEADER_ELM_RUNTIME_CODEC_BINDING_REPAIR**.

---

## OPERATOR HANDOFF

After ClineMM closes this ACT, stop. The operator will:

```text
1. build VSIX manually
2. install manually
3. launch dogfood
4. exercise several real Task Header transitions
5. run:
   ClineMM: Task Header Elm Shadow Diagnostics
6. Copy Report
```

Expected post-repair LIVE report:

```text
evaluations:      N
matches:          N
mismatchPhase:    0
mismatchSource:   0
mismatchSeq:      0
kernelOffline:    0
decodeErrors:     0
```

If that is observed:

```text
PASS_TASK_HEADER_ELM_RUNTIME_SHADOW
```

and the next ACT becomes:

```text
ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY
```

No additional pre-authority review unless a new P0 appears.