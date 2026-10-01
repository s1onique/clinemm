# §4 — Recon: live factual CCARD seam + Elm kernel attachment points

This recon is source-only. No production code is touched yet.

## Surface inspected

- `apps/vscode/src/sdk/continuation-cardinality-authority.ts` (310 lines)
- `apps/vscode/src/sdk/continuation-cardinality-authority-runtime.ts` (100 lines)
- `apps/vscode/src/sdk/completion-authority-elm-replay.ts` (229 lines)
- `apps/vscode/src/sdk/completion-authority-elm-replay.kernel.ts` (255 lines)
- `apps/vscode/src/extension.ts` (activation lifecycle)
- `apps/vscode/src/registry.ts` (command palette)
- `apps/vscode/package.json`
- `apps/vscode/esbuild.mjs`
- `apps/vscode/.vscodeignore`
- All production callers of `captureContinuationCardinalityAuthorityRecord`

## Caller inventory (single helper)

`captureContinuationCardinalityAuthorityRecord` is the ONE production helper. It
is called from the following live seams:

## Answers

### Q1 — What single helper currently receives the factual CCARD record?

**`captureContinuationCardinalityAuthorityRecord(record)`** in
`apps/vscode/src/sdk/continuation-cardinality-authority.ts` (line 235).

It is the SOLE producer of the bounded CCARD ring and the per-stage
counters. Every production call site in the SDK calls this helper
directly.

### Q2 — Does that helper return before/after assigning seq?

**Before.** Line 251:
```ts
if (!captureEnabled) return
```
When the seam is OFF, the helper returns immediately and never
constructs the record. `seq` is assigned at line 254
(`seq: nextSeq++`) AFTER the `captureEnabled` gate. Currently the
helper never constructs a record when CCARD capture is OFF.

### Q3 — Is record construction currently skipped entirely when CCARD capture is OFF?

**Yes.** See Q2. The early return on `!captureEnabled` short-circuits
the entire body.

### Q4 — Where is `captureEnabled` checked?

Two places:

### Q5 — Can one diagnostic observer be attached there without changing existing callers?

**Yes, with a tiny restructure.** The cleanest attachment point is
INSIDE `captureContinuationCardinalityAuthorityRecord` itself. It is
called from every C1..C10 seam and the new `task_started` /
`continuation_started` seams. Attaching the shadow there guarantees:

- No change to ANY existing caller.
- One shadow observation per CCARD record.
- The shadow sees the SAME record the CCARD ring sees (no skew).

The restructure §12/§13 requires is: change the early-return on line
251 from `if (!captureEnabled) return` to
`if (!captureEnabled && !elmShadowWantsThisRecord()) return` so the
helper still constructs the record when ONLY the shadow is enabled.
This preserves `captureEnabled=false + shadow=false → exact old
no-op`.

### Q6 — Does `adaptRecord` mutate or manufacture any identity?

**No.** Source inspection of
`apps/vscode/src/sdk/completion-authority-elm-replay.ts:93-217`
confirms:

- Every identity field (`taskId`, `runId`, `jobId`, `promptId`,
  `submitId`, `completionId`, `ownerId`, `terminalKind`) is read
  directly from the input record.
- Missing values yield `INSUFFICIENT_IDENTITY` with a documented
  reason.
- The `origin` field is preserved verbatim when present and defaulted
  to `"unknown"` only when absent on the record (which is the
  documented CCARD contract — see line 252 of the ring module).
- The function NEVER invents an id; NEVER rewrites an origin.

This MUST remain unchanged. SHADOW02 must call `adaptRecord` and ONLY
`adaptRecord`.

### Q7 — Can the current `loadKernel()` safely create multiple independent Elm.Main.init instances?

**Yes.** `completion-authority-elm-replay.kernel.ts:7-61` (CORRECTION02)
documents and implements exactly this property: the IIFE evaluates
once (global `Elm` cached), and every `loadKernel()` calls
`Elm.Main.init({})` to create a fresh state instance. The replay test
suite proves this with the `freshKernel()` helper at
`completion-authority-elm-historical-replay01.test.ts:103-105`.


### Q8 — Does live extension packaging include `vendor/completion-authority.js`?

**Yes, implicitly.** `.vscodeignore` excludes `src/**`, `scripts/**`,
`proto/**`, `tests/**`, `**/*.ts`, `out/**`, `dist-standalone/**`,
`node_modules/**`, but does NOT exclude `elm/**`. The pattern is
allow-by-default, so
`elm/completion-authority/vendor/completion-authority.js` ships inside
the VSIX at
`extensions/<publisher>.<name>-<version>/elm/completion-authority/vendor/completion-authority.js`.

The esbuild bundle does NOT inline the Elm JS; it remains a runtime
read-from-disk artifact. There is no current production consumer of
it, so the question is purely: does the VSIX contain it. The answer
is yes (discovery proof to be recorded at §24 after the operator-built
VSIX is in hand).

### Q9 — What exact packaged filesystem path can be discovered rather than guessed?

The runtime path resolution strategy: derive the path from
`__dirname/../elm/completion-authority/vendor/completion-authority.js`
relative to the bundled `extension.js` location. Because
`dist/extension.js` is colocated with the `elm/` directory after
packaging (`dist/extension.js` + `elm/...`), the runtime path is
`path.join(path.dirname(__filename), '..', 'elm', 'completion-authority',
'vendor', 'completion-authority.js')` — but it is much cleaner to use
the surrounding `out/...` of `path.dirname(__filename)` (where the
bundled extension.js sits in the VSIX `dist/`). Verification happens at
§24 by inspecting the operator-built VSIX.

### Q10 — What is the correct extension activation lifecycle for creating and destroying shadow state?

**Creation** happens lazily at the FIRST CCARD record observed for a
session that the shadow has been told to track. The shadow is enabled
via `applyElmShadowDiagnosticProfile(env)` at the SAME earliest
initialization seam (`extension.ts:activate`, sibling to BJLA / BOCOR /
CCARD profile resolvers — around line 258). At that point we only need
to record the env-derived boolean and the resolved kernel path; we do
NOT need to load the Elm bundle until a session actually starts.

**Per-session lifecycle** is anchored to `task_started` (the first

### Q11 — Can sessionId be used only as a TS map key, without becoming Elm semantic identity?

**Yes.** Elm's `Model` has no `sessionId` field. The Elm kernel
identifies tasks and runs via `taskId` / `runId` (passed in Msg
constructors). SHADOW02 uses `sessionId` only as the TS map key that
selects which Elm kernel instance receives which input. The Elm model
itself remains session-agnostic. This preserves the load-bearing
property that the same Elm Msg sequence, replayed against any fresh
`Elm.Main.init({})`, produces the same final model.

### Q12 — Is there an existing debug dump/profile mechanism we should reuse rather than invent?

**Yes.** The CCARD dump runtime at
`apps/vscode/src/sdk/continuation-cardinality-authority-runtime.ts`
is the established pattern:

- Dump file: `<globalStorageUri>/continuation-cardinality-authority.jsonl`
- Counter file: `<globalStorageUri>/continuation-cardinality-authority.counters.json`
- Dump command: `commands.DumpContinuationCardinalityAuthority`
- Registry key: `registry.ts:113`
- Activation: `extension.ts:990` (Command Palette registration)

The shadow ring MUST follow the same pattern:

- Ring file: `<globalStorageUri>/completion-authority-elm-shadow.jsonl`
- Counters file: `<globalStorageUri>/completion-authority-elm-shadow.counters.json`
- Dump command: `commands.DumpCompletionAuthorityElmShadow` (new
  registry entry)
- Activation: `extension.ts:activate` Command Palette registration

This avoids inventing a new dump infrastructure.

## Architectural summary

The shadow attaches INSIDE
`captureContinuationCardinalityAuthorityRecord` as a fire-and-forget
observer. The restructure of the early-return is the minimum change
needed to allow `captureEnabled=false + shadow=true` to still
construct the record (so the shadow can observe it). When both are
OFF, the helper is unchanged. When only CCARD is ON, the helper is
unchanged. When only shadow is ON, the helper now constructs a record
once (no ring push, no counter increment) and forwards it to the
shadow.

The shadow runtime:

- Reads `CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW` env at activation.
- Holds a `Map<sessionId, ShadowKernelSession>`.
- Lazy-creates one fresh `loadKernel(KERNEL_PATH)` per session on
  first CCARD observation.
- Per-session FIFO serializes inbound messages to the kernel.
- Captures outbound `state` / `decode_error` and `state.violation` as
  one-row-per-event entries in a bounded ring (default 512).
- Provides a dump command mirroring the CCARD dump.

Authority firewall: zero callbacks from Elm to TS production. All
shadow outputs are diagnostic. No `elm.violation` ever influences
`captureEnabled`, the CCARD ring, the counter, or anything else in
the production path.

CCARD record for a session). When the shadow runtime observes a
`task_started` CCARD record with a sessionId that is not yet in its
session map, it lazily creates a new `ShadowKernelSession` via
`loadKernel(KERNEL_PATH)`.

**Teardown** happens on session end. The CCARD ring has no explicit
"session ended" record (the predecessor did not add one and SHADOW02
must NOT add one). The cleanest teardown trigger is therefore
`agent_turn_done` of the terminal run for a session that has a
`task_completion_committed` recorded: when both have been observed
for the same sessionId, the shadow runtime deletes that session's
kernel. This is a SHADOW-internal event — it does NOT change CCARD
semantics.

The shadow can call `loadKernel(kernelPath)` once per Cline
session/task and obtain an isolated Elm model.


1. `continuation-cardinality-authority.ts:251` — the production helper
   early-return.
2. `continuation-cardinality-authority.ts:125-131` — the module-level
   `isContinuationCardinalityAuthorityCaptureEnabled()` /
   `setContinuationCardinalityAuthorityCaptureEnabled()` API.

The setter is called only from
`dogfood-diagnostic-profile.ts:910,914` via
`applyContinuationCardinalityAuthorityDiagnosticProfile(isDogfood)`.
There is no env override, no workspace toggle, no other entry point.


| File | Line | Stage(s) |
|------|------|----------|
| `sdk/continuation-cardinality-authority.runtime-capture.ts` | 77, 113 | `pending_prompt_dequeued`, `continuation_scheduled` |
| `sdk/command-job-manager.ts` | 2667 | `terminal_committed` |
| `sdk/SdkController.ts` | 3599 | `task_started` |
| `sdk/continuation-cardinality-authority.session-host-capture.ts` | 73, 82, 91, 107 | `run_turn_started`, `execute_turn_prelude_enter`, `agent_turn_done`, `submit_and_exit_seen` |
| `sdk/canonical-event-subscription.ts` | 99, 114 | `task_completion_committed` |

There is no other factual CCARD producer. The list is closed.
