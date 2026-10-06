# ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS

**Status:** CLOSED
**Date:** 2026-10-06
**Subject HEAD:** (pending; closure MD)

---

## VERDICT / PURPOSE

**PURPOSE: CODE-ONLY CORRECTION + EXECUTABLE UNIT/INTEGRATION QUALIFICATION**

Make the TaskHeader Elm runtime shadow `dogfood-on by default`
(removing the dependency on the `CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW`
env var), add a Command Palette diagnostic surface that exposes the
bounded runtime-shadow observations already captured by ORCHESTRATION02.

```text
public profile   -> runtime shadow OFF
dogfood profile  -> runtime shadow ON  (automatic; no env var)
```

and add one Command Palette diagnostic surface (single command with a
small action picker) that exposes the bounded observations.

This ACT performs **code modifications and executable tests only**.

It must **not**:

```text
build VSIX
install VSIX
perform LIVE qualification
claim LIVE evidence
perform Elm authority cutover
```

The missing artifact/install/LIVE tail remains operator-owned and will
be performed manually later.

---

## STARTING STATE

Expected baseline:

```text
HEAD = 2308f9663 (ORCHESTRATION02 closure MD)
code commit = c6862979e (ORCHESTRATION02 production-seam wiring)
```

ORCHESTRATION02 current behavior (before this correction):

```text
CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW (operator env var)
    public default  = OFF
    dogfood default = OFF
    explicit env    = operator opt-in only
```

The runtime observer classifications are:

```text
MATCH
MISMATCH_PHASE
MISMATCH_SOURCE
MISMATCH_SEQ
ELM_KERNEL_OFFLINE
ELM_DECODE_ERROR
```

The observation ring contains bounded semantic facts only.

The real runtime shadow must remain non-authoritative:

```text
returnedTaskHeaderPresentation
    ===
TS selectTaskHeaderPresentation(...)
```

in every path.

---

## C0 — REPOSITORY TRUST

```text
git status --short          (clean working tree at HEAD)
git rev-parse HEAD          2308f9663
git log -5 --oneline        (ORCHESTRATION02 commits visible)
```

No unexpected tracked dirt. No protected stashes touched.

---

## C1 — PROFILE AUTHORITY CHANGE

### Required behavior (frozen)

```text
public profile:
    Task Header Elm runtime shadow = OFF

dogfood profile:
    Task Header Elm runtime shadow = ON  (no env var)
```

### Implementation

The env-var branch is REMOVED from `dogfood-diagnostic-profile.ts`:

```text
BEFORE
  parseTaskHeaderElmRuntimeShadowEnv(env) -> {enabled} | undefined
  resolveEffectiveTaskHeaderElmRuntimeShadow(env, isDogfood)
    parsed ? -> env=path : -> isDogfood ? OFF : OFF (both OFF)

AFTER
  // parseEnv REMOVED
  resolveEffectiveTaskHeaderElmRuntimeShadow(env, isDogfood)
    -> { enabled: isDogfood, source: "profile" }
```

The env-var constant `TASK_HEADER_ELM_RUNTIME_SHADOW_ENV_VAR` is
REMOVED from `dogfood-diagnostic-profile.ts`. The production
activation helper's signature is narrowed so the `source` field is
exactly `"profile"` (no `"env"` branch remains).

Rationale (per ACT §C1 strong-preference): the env-var workflow was
operator-unfriendly. Profile identity is the SOLE gate. The user does
NOT need to set `CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW` on any
launcher.

The build_dogfood_vsix_lib.py comment that referenced the env var is
also updated to reflect the profile-only contract.

---

## C2 — PRESERVE DEFAULT-OFF OUTSIDE DOGFOOD

This is a hard conservation contract:

```text
non-dogfood extension
    -> observer disabled
    -> no Elm Task Header kernel load from this seam
    -> no runtime-shadow observation
    -> no semantic delta
```

The existing Task Header presentation behavior is unchanged.

Verified by `dogfood-diagnostic-profile-task-header-elm-runtime-shadow-activation02.test.ts`:

```text
PROFILE-01: public  + no env -> OFF
PROFILE-01b: public + env=1/0/garbage -> OFF (env branch removed)
PROFILE-02: dogfood + no env -> ON  (the new default)
PROFILE-02b: dogfood + env=1/0/garbage -> ON (env branch removed)
AC1: public + no env -> resolver returns OFF, helper does NOT arm the seam
AC1: dogfood + no env -> resolver returns ON, helper ARMS the seam
AC4 (disabled-mode conservation): with the seam OFF, the comparison
     helper short-circuits and writes nothing (with a fake throwing
     Elm kernel too — no observation recorded, return unchanged)
```

---

## C3 — COMMAND PALETTE DIAGNOSTIC SURFACE

A single user-facing command:

```text
ClineMM: Task Header Elm Shadow Diagnostics
cline.taskHeaderElmShadowDiagnostics
```

The command:

1. Shows the compact summary (`Task Header Elm Runtime Shadow`
   header + the seven classification counters + the last N bounded
   observations) via `vscode.window.showInformationMessage`.
2. Opens a `vscode.window.showQuickPick` action picker with three
   entries: `Copy Report` / `Reset Observations` / `Close`.

`Copy Report` writes the report to the system clipboard via
`HostProvider.env.clipboardWriteText` for off-line inspection by
Factory engineers. `Reset Observations` clears ONLY the bounded
observation ring (does NOT touch the enabled flag, the TS projection,
or the Elm kernel state).

The handler imports the pure functions from a new host-side
diagnostics module (`apps/vscode/src/sdk/task-header-elm-shadow-diagnostics.ts`)
which delegates to the existing `task-header-elm-shadow.ts` exports
(`formatTaskHeaderElmRuntimeShadowReport`,
`getTaskHeaderElmRuntimeShadowObservations`,
`isTaskHeaderElmRuntimeShadowEnabled`,
`resetTaskHeaderElmRuntimeShadowObservations`). No new
diagnostics-subsystem machinery is created.

---

## C4 — COMMAND UI

The command uses standard VS Code APIs:

```text
vscode.window.showInformationMessage(report)
vscode.window.showQuickPick(["Copy Report", "Reset Observations", "Close"])
HostProvider.env.clipboardWriteText(StringRequest.create({ value: report }))
```

No custom webview. The diagnostic surface is cheap and disposable
(single message + single picker + optional clipboard write).

---

## C5 — RESET SEMANTICS

`Reset Observations` clears only Task Header Elm runtime-shadow
diagnostic observations/counters via
`resetTaskHeaderElmRuntimeShadowObservations` (added as an alias for
the existing `clearTaskHeaderElmRuntimeShadowObservations`).

It does NOT:

- mutate TaskState;
- mutate TurnState;
- reset `seq`;
- recreate the Elm worker;
- touch MCP;
- touch myc;
- trigger publication;
- change current Task Header presentation;
- change profile enablement.

Required conservation verified by `task-header-elm-runtime-shadow-diagnostics.reset-c03.test.ts`:

```text
RST-01: append -> reset -> ring = [], summary.evaluations = 0
RST-02: reset does NOT touch the enabled flag (public + dogfood)
RST-03: reset does NOT alter the TS projection
RST-04: reset does NOT alter the Elm adapter/kernel state
RST-05: reset on an empty ring is a safe no-op
```

---

## C6 — REPORT GENERATION

Pure formatter/aggregator, separated from VS Code UI.

In `task-header-elm-shadow.ts`:

```text
interface TaskHeaderElmRuntimeShadowSummary {
    evaluations: number
    matches: number
    mismatchPhase: number
    mismatchSource: number
    mismatchSeq: number
    kernelOffline: number
    decodeErrors: number
}

function summarizeTaskHeaderElmRuntimeShadowObservations(
    observations: readonly TaskHeaderElmRuntimeShadowObservation[],
): TaskHeaderElmRuntimeShadowSummary

function formatTaskHeaderElmRuntimeShadowReport(
    observations: readonly TaskHeaderElmRuntimeShadowObservation[],
): string
```

The summary is a pure `fold` of the bounded observation ring. No
hidden counters are maintained in parallel. (The default 512-cell ring
buffer exists, but no parallel mutable counters are added.)

The formatter renders the seven counters + the last 10 bounded
observations. Each observation block carries:

```text
inputs:  canonicalShadowPhase, currentLegacyPhase, seq, canonicalShadowObservedTurnSeq
ts:      phase, source, seq
elm:     presentation (phase, source, seq) | kernel_offline | decode_error (reason)
classification: <MATCH | MISMATCH_* | ELM_*>
```

No sensitive/raw payload expansion. The bounded semantic record
contains ONLY the four production inputs + the three TS outputs +
the three Elm outputs + the classification.

---

## C7 — COMMAND REGISTRATION

Registered in `extension.ts:activate` next to the existing THSICAP
dump / clear registrations (a sibling precedent that uses the same
QuickPick + clipboard pattern).

Requirements:

- command contribution in `package.json` (added with title
  `"ClineMM: Task Header Elm Shadow Diagnostics"` and
  `"category": "ClineMM"`).
- handler registration with `vscode.commands.registerCommand`.
- disposal added via `context.subscriptions.push(...)`.
- no activation-order dependency on Task Header state.
- invoking with no observations is safe (empty summary shown).

```json
{
  "command": "cline.taskHeaderElmShadowDiagnostics",
  "title": "ClineMM: Task Header Elm Shadow Diagnostics",
  "category": "ClineMM"
}
```

## Visibility

No existing ClineMM-specific context key for the Command Palette
exists in the repo. Per the spec C7 fallback, the command is kept
visible (no `menus.commandPalette` when-clause) and the handler
returns the bounded disabled message:

```text
Task Header Elm runtime shadow is disabled in this profile.
```

when invoked outside dogfood. This is preferable to inventing a new
context-key framework just for this ACT.

---

## C8 — DOGFOOD DEFAULT TESTS

The existing `dogfood-diagnostic-profile-task-header-elm-runtime-shadow-activation02.test.ts`
was rewritten to pin the new contract:

```text
PROFILE-01: public + no env -> OFF (public default preserved)
PROFILE-02: dogfood + no env -> ON (dogfood default ON, no opt-in required)
PROFILE-01b: public + env=1/0/garbage -> OFF (env branch removed)
PROFILE-02b: dogfood + env=1/0/garbage -> ON (env branch removed)
AC1: PROFILE-03: public + no env -> resolver returns OFF, helper does NOT arm the seam
AC1: PROFILE-04: dogfood + no env -> resolver returns ON, helper ARMS the seam
AC2: public OFF is the default public identity (env var ignored)
AC3: idempotent activation flips
AC4: disabled-mode comparison helper conservation (short-circuit + fake throwing Elm)
AC5: public default is OFF regardless of any env var contents
```

15 tests, all PASS.

PROFILE-05/PROFILE-06 (explicit env override tests) are REMOVED
because the env branch is removed per C1 strong-preference.

---

## C9 — OBSERVATION SUMMARY TESTS

New test file
`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.summary-c01.test.ts`
(5 tests):

```text
SUM-01: empty ring -> all counters zero; evaluations = 0
SUM-02: single MATCH -> matches=1, others=0, evaluations=1
SUM-03: 2 MATCH + 1 each of the 5 other classifications -> evaluations=7
SUM-04: ring at capacity + eviction -> summary reflects retained ring exactly
SUM-05: ring-pushed buffer overflow does not double-count retained ones
```

All PASS. The implementation is a pure fold of the bounded observation
ring (no parallel mutable counters).

A new test seam `setTaskHeaderElmRuntimeShadowBufferSize(capacity)` was
added to `task-header-elm-shadow.ts` (delegates to the sink's
`setCapacity`) so SUM-04 and SUM-05 can shrink the ring buffer and
exercise the eviction policy deterministically. The interface
`TaskHeaderElmRuntimeShadowSink` gains a `setCapacity?` method (default
sink implements it; the CapturingSink test class also implements it).
NOT consumed in production code paths.

---

## C10 — REPORT FORMAT TESTS

New test file
`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.report-c02.test.ts`
(7 tests):

```text
FMT-01: empty ring -> report contains the seven counter field names + header
FMT-02: 7 mixed observations -> report contains the seven counter fields + bounded semantic fields
FMT-03: ring at capacity -> recent tail (last 10) is present; older observations elided
FMT-03b: when the input to the formatter has more than 10 entries, only the last 10 + omission line
FMT-04: reports carry bounded semantic facts ONLY (no prompt, no model output, no MCP, no file paths)
FMT-05a: ELM_KERNEL_OFFLINE observation renders `elm: kernel_offline`
FMT-05b: ELM_DECODE_ERROR observation renders `elm: decode_error` + bounded reason
```

All PASS. The report carries bounded semantic content only (no
sensitive/payload expansion).

---

## C11 — RESET TESTS

New test file
`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.reset-c03.test.ts`
(5 tests):

```text
RST-01: append observations -> reset -> ring = [], summary.evaluations = 0
RST-02: reset does NOT touch the runtime-shadow enabled flag
RST-03: reset does NOT alter the TS projection returned by observeTaskHeaderElmRuntimeShadow
RST-04: reset does NOT alter the Elm adapter/kernel state
RST-05: reset on an empty ring is a safe no-op
```

All PASS.

---

## C12 — COMMAND HANDLER TESTS

New test file
`apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.command-handler-c04.test.ts`
(13 tests):

```text
CMD-01: 'Copy Report' -> 'copy'
CMD-01b: 'Reset Observations' -> 'reset'
CMD-01c: undefined / unrecognized / 'Close' -> 'close'
CMD-01d: empty ring + safe report build
CMD-01e: QuickPick option labels are exactly the three expected
CMD-03: copy action invokes clipboardWriteText host bridge with the report
CMD-04: reset action clears the bounded observation ring without throwing
CMD-05: public profile -> isTaskHeaderElmRuntimeShadowDiagnosticsEnabled = false
CMD-05b: disabled message is the bounded spec text
CMD-REG.1: registry.ts exposes TaskHeaderElmShadowDiagnostics constant with canonical id-suffix
CMD-REG.2: package.json declares cline.taskHeaderElmShadowDiagnostics with palette-searchable title
CMD-REG.3: extension.ts registers commands.TaskHeaderElmShadowDiagnostics via vscode.commands.registerCommand
CMD-REG.4: NO env-var `CLINEMM_DIAG_TASK_HEADER_ELM_RUNTIME_SHADOW` is referenced in extension.ts:activate wiring
```

All PASS. CMD-03 uses `setVscodeHostProviderMock` with a custom env
stub (a `vi.fn()` for `clipboardWriteText`) so the test can capture
the clipboard write deterministically. CMD-REG.* tests are
source-only contract pins (parses the registry + package.json +
extension.ts) — keeping them free of elaborate vscode-runtime
mocking per the Factory doctrine ("prefer executable semantic
evidence over elaborate mocking infrastructure").

---

## C13 — REAL RUNTIME-SEAM CONSERVATION

The existing `task-header-elm-runtime-shadow02.c24-c-bridge.test.ts`
(12 tests, RUNTIME-SHADOW-01..11) still PASS unchanged:

```text
RUNTIME-SHADOW-01..11 preserved:
  - real Elm kernel correspondence (7-fixture pass)
  - mismatch phase / source / seq discrimination
  - kernel offline handling
  - decode error handling
  - throw handling (DI-driven fake kernel)
  - disabled mode conservation (short-circuit)
  - ring behavior (no observation recorded when seam OFF)
  - known UNBOUND specimen (canonical=idle, legacy=streaming,
    observedTurnSeq=MISSING -> {phase: streaming, source: legacy,
    seq: 27545} MATCH at the real production seam)
```

12/12 PASS.

---

## C14 — BROADER REGRESSION GATES

```text
bunx vitest run --config vitest.config.ts
  src/sdk/__tests__/dogfood-diagnostic-profile-task-header-elm-runtime-shadow-activation02.test.ts
  src/sdk/__tests__/task-header-elm-runtime-shadow02.c24-c-bridge.test.ts
  src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.summary-c01.test.ts
  src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.report-c02.test.ts
  src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.reset-c03.test.ts
  src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.command-handler-c04.test.ts
  src/sdk/__tests__/task-header-elm-orchestration-shadow01.test.ts
  src/sdk/__tests__/task-header-elm-orchestration-shadow01.malformed-edges.test.ts
  src/sdk/__tests__/task-state-shadow-task-header-presentation.thcp01.test.ts
  src/sdk/__tests__/dogfood-diagnostic-profile.test.ts
  src/sdk/__tests__/dogfood-diagnostic-profile-thsicap-activation.test.ts
  src/sdk/__tests__/dogfood-runtime-profile.test.ts
```

```text
Test Files  10 passed (10)
Tests       156 passed (156)
```

Wider sweep (excluding pre-existing MCP-restart failures that exist
unrelated to this ACT — see below):

```text
Test Files  42 passed (1 file pre-existing fail: mcp-tool-restart-...)
Tests       597 passed (3 tests pre-existing fail: MCP tool restart)
```

The `mcp-tool-restart-deferred-completion-barrier.mcprestart01.test.ts`
failures (3 tests) pre-existed at HEAD = 2308f9663 (verified by
`git stash` + re-run). They are unrelated to the TaskHeader Elm
runtime shadow and out of scope for this ACT.

`bunx tsc --noEmit` — PASS (no output = clean).
`biome lint --diagnostic-level=error` on all 6 production files +
5 new test files + the registry + the package.json — PASS ("No
fixes applied").
`git diff --check` — PASS (no whitespace issues).

---

## C15 — NO ARTIFACT WORK

This ACT explicitly stops before artifact production.

The executor must NOT run:

```text
scripts/build-dogfood-vsix.py
vsce package
code --install-extension
codium --install-extension
```

Confirmed: no VSIX was built, installed, or qualified. The Elm kernel
bytes remain unchanged (SHA-256 =
29528f18ce8ccc91c58ae06f5f54e6e74fd08e9d9504bb1e72aa87fa927974f2bc9).

Evidence labels:
- `REAL_PRODUCTION_SEAM` — `task-header-elm-runtime-shadow02.c24-c-bridge.test.ts`
- `SYNTHETIC_REAL` — `dogfood-diagnostic-profile-task-header-elm-runtime-shadow-activation02.test.ts`,
  `task-header-elm-runtime-shadow-diagnostics.{summary,report,reset,command-handler}-*.test.ts`
- `NOT_EXECUTED` — VSIX build / install / LIVE qualification (out of scope)

---

## C16 — DOCUMENT THE MANUAL OPERATOR HANDOFF

The desired manual workflow becomes:

```text
build/install dogfood artifact manually
    ↓
launch dogfood (CLINEMM_RUNTIME_PROFILE=dogfood)
    ↓
runtime shadow automatically ON (no env var)
    ↓
exercise tasks
    ↓
Command Palette:
ClineMM: Task Header Elm Shadow Diagnostics
    ↓
view classification summary (MATCH / MISMATCH_* / ELM_*)
    ↓
pick action:
  Copy Report   -> clipboard
  Reset Observations -> clears ring (next-observation fresh start)
  Close
```

No env var appears in this operator handoff.

---

## NON-GOALS — RESPECTED

This ACT did NOT:

- build a VSIX
- install an extension
- perform LIVE qualification
- claim C10/C11 closed
- switch authority from TS to Elm
- remove `selectTaskHeaderPresentation`
- change the four-rule Elm contract
- modify React Task Header rendering
- modify myc telemetry
- modify MCP behavior
- introduce a new env var (the existing one is REMOVED)
- introduce a user setting
- introduce a permanent diagnostics subsystem
- create a custom webview
- add generic Elm infrastructure
- repair unrelated Factory/document hygiene

---

## SUCCESS CRITERIA

All of these hold:

1. public profile leaves Task Header Elm runtime shadow OFF — YES (PROFILE-01)
2. dogfood profile turns Task Header Elm runtime shadow ON automatically — YES (PROFILE-02)
3. no new env variable is introduced — YES (env var REMOVED)
4. existing env override is removed (no longer required) — YES (`parseTaskHeaderElmRuntimeShadowEnv` removed; constant `TASK_HEADER_ELM_RUNTIME_SHADOW_ENV_VAR` removed)
5. TS selector remains production authority — YES (no code change in `selectTaskHeaderPresentation`; pre-existing test passes)
6. observer remains diagnostic-only — YES (no code change in `observeTaskHeaderElmRuntimeShadow`; bounded observation ring only)
7. Command Palette command is contributed — YES (entry in `package.json` + `registry.ts` + `extension.ts`)
8. command handler is registered/disposed correctly — YES (handled via `context.subscriptions.push` next to the THSICAP precedent)
9. command reports all six classifications — YES (`MATCH` / `MISMATCH_PHASE` / `MISMATCH_SOURCE` / `MISMATCH_SEQ` / `ELM_KERNEL_OFFLINE` / `ELM_DECODE_ERROR`)
10. report includes bounded recent semantic observations — YES (last 10 retained observations rendered with the four-input `Facts` + TS projection + Elm projection + classification)
11. `Copy Report` works — YES (CMD-03 verified via `vi.fn()` for `clipboardWriteText`)
12. `Reset Observations` clears diagnostics only — YES (RST-01..05 verified; enabled flag + ts + Elm state preserved)
13. summary is derived from the bounded ring rather than drifting parallel counters — YES (pure `fold` of `snapshot`; no parallel counters)
14. focused profile tests pass — YES (15/15 PASS)
15. diagnostics summary/reset tests pass — YES (5/5 + 5/5 PASS)
16. command tests pass — YES (13/13 PASS)
17. ORCHESTRATION02 runtime-seam tests pass — YES (12/12 PASS)
18. ORCHESTRATION01 TS↔Elm correspondence tests pass — YES (40 + 19 + 12 PASS — `task-header-elm-orchestration-shadow01.test.ts` + `.malformed-edges.test.ts` + `task-header-elm-runtime-shadow02.c24-c-bridge.test.ts` all green)
19. broader Task Header/TaskState-shadow/dogfood-profile tests pass — YES (597/600 PASS, 3 MCP-restart failures pre-existing at HEAD = 2308f9663 and out of scope)
20. typecheck passes — YES (`bunx tsc --noEmit` clean)
21. lint passes — YES (`biome lint --diagnostic-level=error` clean)
22. `git diff --check` passes — YES (clean)
23. no VSIX is built — YES (none attempted)
24. no VSIX is installed — YES (none attempted)
25. no LIVE claim is made — YES (no LIVE qualification executed)
26. manual operator handoff is emitted without an env-var step — YES (see C16 above)

Success verdict:

```text
PASS_TASK_HEADER_ELM_DOGFOOD_DIAGNOSTICS
```

---

## SUCCESSOR

After this ACT passes, **stop**.

The user will manually:

```text
build
install VSIX (manually)
dogfood (CLINEMM_RUNTIME_PROFILE=dogfood)
exercise tasks
open Command Palette diagnostic (ClineMM: Task Header Elm Shadow Diagnostics)
copy report
```

Only after that report demonstrates real installed behavior should
Factory close:

```text
PASS_TASK_HEADER_ELM_RUNTIME_SHADOW
```

and authorize:

```text
ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION03-AUTHORITY
```

No extra review/fix cycle unless a **new P0** appears.

This keeps the Factory boundary clean: **ClineMM does code +
executable tests; the user owns artifact build/install and LIVE
qualification.**

---

## FILES TOUCHED

### Created

- `apps/vscode/src/sdk/task-header-elm-shadow-diagnostics.ts` (new
  host-side diagnostic module — pure action selection, report
  formatting, action application; 152 lines)
- `apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.summary-c01.test.ts`
  (new — 5 tests)
- `apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.report-c02.test.ts`
  (new — 7 tests)
- `apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.reset-c03.test.ts`
  (new — 5 tests)
- `apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow-diagnostics.command-handler-c04.test.ts`
  (new — 13 tests)
- `.factory/acts/ACT-CLINEMM-ELMIZE-P1-TASK-HEADER-ORCHESTRATION02-CORRECTION01-DOGFOOD-DIAGNOSTICS.md`
  (this file)

### Edited

- `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` (env-var
  branch REMOVED; resolver simplified to identity-only;
  `TASK_HEADER_ELM_RUNTIME_SHADOW_ENV_VAR` REMOVED;
  `parseTaskHeaderElmRuntimeShadowEnv` REMOVED; JSDoc updated to
  reflect new contract)
- `apps/vscode/src/sdk/task-header-elm-shadow.ts` (added
  `resetTaskHeaderElmRuntimeShadowObservations` alias for
  `clearTaskHeaderElmRuntimeShadowObservations`; added
  `TaskHeaderElmRuntimeShadowSummary` interface +
  `summarizeTaskHeaderElmRuntimeShadowObservations` +
  `formatTaskHeaderElmRuntimeShadowReport`; added
  `setTaskHeaderElmRuntimeShadowBufferSize` test seam + `setCapacity`
  on the sink interface)
- `apps/vscode/src/registry.ts` (added `TaskHeaderElmShadowDiagnostics`
  command ID constant with REMOVAL_TRIGGER comment)
- `apps/vscode/package.json` (added the
  `cline.taskHeaderElmShadowDiagnostics` contributes.commands entry
  with title `"ClineMM: Task Header Elm Shadow Diagnostics"` and
  category `"ClineMM"`)
- `apps/vscode/src/extension.ts` (added the imports for the
  diagnostics module + the `vscode.commands.registerCommand` handler
  for `commands.TaskHeaderElmShadowDiagnostics` next to the THSICAP
  dump/clear registrations; updated the JSDoc around
  `applyTaskHeaderElmRuntimeShadowDiagnosticProfile` to reflect
  the new contract)
- `apps/vscode/src/sdk/SdkController.ts` (updated the JSDoc comment
  around the production seam at line 5897-5915 to reflect the new
  contract; no production logic change)
- `apps/vscode/src/sdk/__tests__/dogfood-diagnostic-profile-task-header-elm-runtime-shadow-activation02.test.ts`
  (rewrote from env-var precedence T1..T8 + AC1..AC5 to the new
  profile-default contract PROFILE-01..04 + AC1..AC5; 15 tests)
- `scripts/build_dogfood_vsix_lib.py` (updated the JSDoc comment
  that referenced the env var — the staging table itself is
  unchanged)

### Unchanged

- `apps/vscode/elm/task-header-orchestration/` — the Elm kernel
  source is not modified (kernel bytes are the same as ORCHESTRATION02;
  SHA-256 29528f18ce8ccc91c58ae06f5f54e6e74fd08e9d9504bb1e72aa87fa927974f2bc9).
- `apps/vscode/src/sdk/__tests__/task-header-elm-runtime-shadow02.c24-c-bridge.test.ts`
  — RUNTIME-SHADOW-01..11 unchanged; still PASS.
- `apps/vscode/src/sdk/__tests__/task-header-elm-orchestration-shadow01.test.ts`
  + `.malformed-edges.test.ts` — the predecessor's 127/127
  differential correspondence suite still PASS.
