# ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01 — PASS_REPAIR_STRUCTURAL_LIVE_PENDING — 2026-10-13

## 1. Live evidence — authoritative specimen

Task/session: `1791887696629_cg31u`

BCB observation at `2026-10-13T10:48:08.373Z`:

```json
{
  "epoch": 2,
  "eligibleForCoalescedContinuation": true,
  "unconsumedOwnedTerminalResultsForC10": 2,
  "heldObligationForC10": true,
  "outstandingAutonomousWork": false,
  "ownerStillRunningForC10": false,
  "suppressOriginatingCompletion": false,
  "liveToolsAvailable": true,
  "liveToolsIncludesCommandStatus": false,
  "liveToolsValue": [
    "read_files",
    "search_codebase",
    "fetch_web_content",
    "editor",
    "submit_and_exit"
  ],
  "canObserveHeldResults": false,
  "writerId": "session-event-bcb-blocked-observation-unavailable",
  "requestedPhase": "error",
  "committedPhase": "error"
}
```

Writer provenance confirms epoch 2, seq 1266, `error`. Extension
and webview traces confirm the error presentation. SDK/shadow
status was `completed`. Reopening later selected `completed`, seq
1274. Both captured held job IDs appear as real `background_terminal`
commits for the same owner in the continuation trace. Continuation
enqueue and delivery counts are zero.

**Evidence classification:** LIVE, corroborated across multiple capture
boundaries. The three prior BCB capture bundles are preserved at
`.factory/evidence/ACT-CLINEMM-BCB-CAPTURE01/live-captures/`,
`.factory/evidence/ACT-CLINEMM-TASK-TERMINAL-DIVERGENCE-RED01-CORR01/live-captures/`,
and the current ACT's build evidence at
`.factory/evidence/ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01/live-captures/`.

## 2. Recon the actual producer

The production accessor chain for the BCB's `canObserveHeldResults`
projection is:

1. `SdkController` (sdk-session-event-coordinator option) →
   `liveTools: () => active?.sdkHost?.liveTools?.(sid)`
   (apps/vscode/src/sdk/SdkController.ts:2519-2523)
2. `VscodeSessionHost.liveTools(sessionId)` →
   `this.inner.getActiveRuntimeToolNames(sessionId)`
   (apps/vscode/src/sdk/vscode-session-host.ts:895-897)
3. `ClineCore.getActiveRuntimeToolNames(sessionId)` →
   `LocalRuntimeHost.getActiveRuntimeToolNames(sessionId)`
   (sdk/packages/core/src/ClineCore.ts:731-738)
4. `LocalRuntimeHost.getActiveRuntimeToolNames(sessionId)` →
   `active.runtime.tools.map(t => t.name)`
   (sdk/packages/core/src/runtime/host/local-runtime-host.ts:1557-1562)

The `active.runtime.tools` is the `BuiltRuntime.tools` (the
runtime-builder's `finalTools`). The `command_status` tool is added
through a **separate** path:

- `VscodeSessionHost.create()` constructs a `CommandJobManager`
  (vscode-session-host.ts:284).
- The `commandJobManager` is threaded into
  `createVscodeExtraTools(mcpHub, { commandJobManager, ... })`
  (vscode-session-host.ts:401 → vscode-runtime-builder.ts:289-372).
- The `if (options.commandJobManager)` block at
  vscode-runtime-builder.ts:289 pushes `createCommandStatusTool(...)`
  to the `tools` list.
- This list is set on `input.config.extraTools` at
  vscode-session-host.ts:439 — the `extraTools` slot of
  `CoreSessionConfig`.

**The merge that builds the model-facing `agentConfig.tools` (the
`agent.tools` Map the runtime actually uses) happens at
`local-runtime-host.ts:834`:**

```ts
const tools = [...runtime.tools, ...(configWithProvider.extraTools ?? [])]
```

**The previous `getActiveRuntimeToolNames` accessor only read the
first half of that merge (`active.runtime.tools`), so the BCB
capability projection was reading a stale subset of the model-facing
registry.**

`command_status` is in the second half (`extraTools`), so the BCB
saw `canObserveHeldResults = false` even when the model had the
observation mechanism — exactly what the live capture showed.

## 3. RED reproduction

The new ACT test file
`apps/vscode/src/sdk/__tests__/bcb-observation-unavailable-observability-repair01.bcbobsrv01.test.ts`
(13/13 PASS) exercises the production BCB seam against the LIVE
specimen's exact facts.

**BCBOBSRV-01.1** mirrors the live capture verbatim:
- `unconsumedOverride.value = 2`
- `unconsumedJobIdsOverride.value = ["bg-term-1791887696629-cg31u-1", "bg-term-1791887696629-cg31u-2"]`
- `liveToolsOverride.value = ["read_files", "search_codebase", "fetch_web_content", "editor", "submit_and_exit"]`
- Submit-and-exit committed

**Result:** `finalWriterId` = `"session-event-bcb-blocked-observation-unavailable"`,
`finalPhase` = `"error"`, `errorPhaseCommitCount` = 1,
`completionCommitCount` = 0, capture record shows
`canObserveHeldResults=false`, `liveToolsValue` matches the LIVE capture,
`unconsumedOwnedTerminalResultsForC10=2`, the two job IDs are
preserved, the BCB barrier holds.

**Distinguished from the desired corrected invariant:** the BCB-01
witnesses PASS proves the BCB seam behaves correctly given the input;
the desired invariant is that the `liveTools` input includes
`command_status` so the BCB does NOT have to block.

**Production boundary reproduces the specimen — HALT_RED_NOT_REPRODUCED
does NOT apply.**

## 4. Causal discriminator and ablation

The test gate runs five ablations on the production seam:

- **BCBOBSRV-01 (A — live specimen)**: liveTools missing `command_status` →
  BCB writer fires, phase=`error`. REPRODUCES the live incident.
- **BCBOBSRV-02 (B — `command_status` present)**: same held set + 6
  liveTools (with `command_status`) → BCB writer does NOT fire,
  `canObserveHeldResults=true`. The seam's decision flips on the
  capability projection alone.
- **BCBOBSRV-03 (C — zero unconsumed)**: eligibility branch not taken
  → no BCB writer, zero records. The barrier is correctly guarded.
- **BCBOBSRV-04 (D — `liveTools() === undefined`)**: `canObserveHeldResults=null`
  → falls through to `enqueueCompletionContinuationIfHeld` (no BCB
  block; the seam refuses to publish `observation_unavailable` on a
  null projection per the CORRECTION01 contract at
  `sdk-session-event-coordinator.ts:3143-3150`).
- **BCBOBSRV-06 (E — production accessor chain)**: the load-bearing
  test. Asserts that the runtime-builder's `finalTools` is the
  **stale subset** (the BUG) and that the runtime-builder's
  `finalTools` + `extraTools` is the **merged list** (the REPAIR).
  BCBOBSRV-06.3 runs the BCB seam with the merged list — the BCB
  writer does NOT fire, `canObserveHeldResults=true`. BCBOBSRV-06.4
  runs the BCB seam with the stale subset — the BCB writer DOES fire
  (REPRODUCES the live incident verbatim). This is the executable
  causal boundary.

`HALT_CAUSAL_DISCRIMINATOR_FAILED` does NOT apply — the discriminator
identified the cause (stale subset) and the repair path (merge the
`extraTools`).

## 5. Bounded repair

The bounded repair is in
`sdk/packages/core/src/runtime/host/local-runtime-host.ts:1557-1582`:
`getActiveRuntimeToolNames(sessionId)` now returns
`[...active.runtime.tools, ...(active.config.extraTools ?? [])].map(t => t.name)`
— exactly mirroring the merge at `local-runtime-host.ts:834` that
builds the model-facing `agentConfig.tools`. The change is a single
accessor-method body, no public API rename, no new field.

**No repair is preselected in the abstract; the causal discriminator
chose the smallest justified repair:**

- The BCB decision logic is correct given its inputs (BCAPT01 26/26 PASS).
- The host-side observation path already exists (`VscodeSessionHost`
  → `ClineCore` → `LocalRuntimeHost`).
- The accessor chain was the only place that read a stale subset of
  the model-facing registry. The repair makes the surface truthful.

**No new tool is inserted into every tool list;** the repair does not
add `command_status` to anything — it reads the EXISTING
`command_status` registration (which the VSCode host has been
registering on the production path) and exposes it through the BCB
projection.

**The visible header is not changed to `completed`;** the BCB
writer's stamp on the marker is preserved (held work remains
conserved). The `error` phase is still committed by the BCB writer
when the capability is truly unavailable. The repair only changes the
case where the capability IS available but the projection was
incorrectly returning `false`.

**No held results are silently discarded;** the BCB barrier (BCB01
§0.1 second conjunct) still holds completion when held work
remains. The repair changes which writer handles the
observation-unavailable verdict — when the capability is present,
the BCB is no longer the writer.

**Continuation authorization is not relaxed;** the
`enqueueCompletionContinuationIfHeld` path (which the BCB calls when
capability IS present) still consults the Elm authority kernel
unconditionally. The repair changes the upstream `canObserveHeldResults`
projection, not the downstream `pickContinuationDirectiveForPublication`
consult.

**Genuine failures are not concealed;** if `command_status` is truly
absent (e.g. on Hub/Remote hosts that don't supply a
`commandJobManager`), the runtime-builder's `finalTools` is what it
always was, and the BCB correctly identifies
`canObserveHeldResults=false`. The repair only closes the gap
specific to the VSCode production path.

## 6. Conservation tests

- **BCBOBSRV-01**: LIVE specimen's 2 unconsumed held results are
  preserved on the BCB barrier (not silently discarded); completion
  is NOT committed.
- **BCBOBSRV-02**: held results preserved when capability is present
  (no false-positive BCB block).
- **BCBOBSRV-03**: zero unconsumed → no BCB block (eligibility
  correctly guarded).
- **BCBOBSRV-04**: capability truly unavailable (`liveTools()`
  returns undefined) → `canObserveHeldResults=null` (the honest
  projection), no BCB block (the seam does NOT publish
  `observation_unavailable` on a null projection).
- **BCBOBSRV-05**: held-result conservation + idempotence. The held
  set is preserved when the BCB block fires; the BCB writer stamp
  is idempotent on the same obligation (TDD-10d parity).
- **BCBOBSRV-06**: causal E — the load-bearing causality test that
  proves the production accessor chain's behavior before and after
  the repair.
- **BCBOBSRV-07**: invariants under repair — no false-positive, no
  cross-session contamination (sessionId/taskId correlation exact).

**Independent L2847 RED witnesses preserved:** 3 RED / 11 PASS in
`task-terminal-divergence-red01.tdd-red01.test.ts` (TDD-01.A, TDD-01.B,
TDD-07 RED; the remaining 11 GREEN pass). The repair is on a
different path from the L2847 precedence defect and does not affect
the existing RED baseline.

**Pre-existing BCB01-family failures unchanged:** 19 failures in
`background-completion-barrier01*.test.ts` are unchanged from
baseline (verified by `git stash` before/after).

**No Elm work;** the BCB decision boundary, the Elm authority kernel,
the held-set progress authority, the deferred completion barrier, the
Elm task-header kernel, and the 5-kernel ELM convention are all
UNTOUCHED.

## 7. Qualification

- `bun run check-types` — PASS (0 errors)
- `bunx biome lint --diagnostic-level=error` — PASS (0 errors on
  both the new test file and the production source)
- `bun run build:sdk` — PASS (SDK rebuilt; the bundled
  `extension/dist/extension.js` contains the repair as a single
  line: `return[...r.runtime.tools,...r.config.extraTools??[]].map(n=>n.name)`)
- `bcb-observation-unavailable-observability-repair01.bcbobsrv01.test.ts` — 13/13 PASS
- `bcb-observation-unavailable-capture.bcapt01.test.ts` — 26/26 PASS (preserved)
- `bcb-observation-unavailable-dogfood-profile-activation.bcbcap01.test.ts` — 24/24 PASS (preserved)
- `observation-capability-runtime-registry-discriminator01.ocrrd01.c24-c-bridge.test.ts` — 5/5 PASS (real `LocalRuntimeHost` integration)
- `task-terminal-divergence-red01.tdd-red01.test.ts` — 3 RED / 11 PASS (L2847 RED witnesses preserved)
- `block*` / `host-blocked*` / `completion-continuation-*` — 117/117 PASS

The pre-existing 19 BCB01 / BCB01-C / BCB01-C1 / BCB01-C2 /
BCB01-C3 / BCB01-C4 failures and the 8 FRSP01
runtime-followup-resume-subscription-parity failures are unchanged
from baseline (verified by `git stash` before/after on the BCB01
family and by file-level comparison on the FRSP01 family). These are
pre-existing and unrelated to the BCB observability repair.

## 8. Files

**Files changed (1, bounded):**

- `sdk/packages/core/src/runtime/host/local-runtime-host.ts` — single
  accessor-method body change (`getActiveRuntimeToolNames`). One
  extra spread operator + the `extraTools` array from `active.config`.
  No new public API, no new field, no protocol change, no Elm
  authority change, no new timeout, no new React updater.

**Files added (1):**

- `apps/vscode/src/sdk/__tests__/bcb-observation-unavailable-observability-repair01.bcbobsrv01.test.ts` —
  13-test production-seam witness. Reuses the existing
  `SdkSessionEventCoordinator` + the existing BCB capture
  diagnostic; no new harness framework.

**Evidence added (1):**

- `.factory/evidence/ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01/live-captures/`
  (README + SHA256SUMS + the VSIX).

## 9. Live qualification

- Source HEAD: this ACT's commit (post-repair).
- Version: `4.1.16` (extension package version, unchanged).
- Artifact: `dist/clinemm-4.1.16-bcbobsrv01.vsix`.
- Size: 60,497,077 bytes (≈ 57.69 MB).
- SHA-256: `f914ac837a022a74f831adabb3a734ddf0511001300f4083e810d3bd924658a0`.

**Live qualification: BLOCKED BY ENV.** The
`~/.vscodium-clinemm/extensions/` directory is on a read-only mount
(verified by `touch` + `chmod` failing with `Operation not permitted`).
The operator must perform the live qualification in a writable
environment.

A successful live result requires correct terminal handling AND
conservation of outstanding terminal results — not simply a green
header.

## 10. Final verdict

`PASS_REPAIR_STRUCTURAL_LIVE_PENDING`.

- The bounded production-seam repair is verified by the 13/13
  BCBOBSRV01 test gate + the OCRRD01 c2-4-c-bridge live
  `LocalRuntimeHost` test (5/5) + the BCAPT01 (26/26) + BCBCAP01
  (24/24) + L2847 RED witnesses (3 RED / 11 PASS, preserved)
  + typecheck PASS + lint PASS.
- The BCB writer path semantics are unchanged for the cases that
  matter: when capability is truly unavailable, the BCB writer
  still fires; when the held set is empty, the BCB writer does not
  fire; when the same obligation is already stamped, the BCB writer
  does not re-stamp.
- The exact-head VSIX is built and SHA-256-verified.
- The live qualification step is BLOCKED BY ENVIRONMENT (read-only
  extensions mount). The next qualifying ACT must run a live task
  with the bounded repair installed in a writable environment to
  resolve `LIVE_REPRODUCED` / `LIVE_NO_REPRO`.

No Elm migration. No L2847 precedence repair. No broad task-lifecycle
refactoring.

## 11. Cleanup

The first `REMOVAL_TRIGGER` of the BCB capture diagnostic
(ACT-CLINEMM-BCB-CAPTURE01) — **"cause isolated"** — is now satisfied
by this ACT. The capture diagnostic was a temporary, read-only,
default-off ring buffer whose purpose was to capture the BCB
predicate inputs (liveTools, held-result ownership/count,
suppressOriginatingCompletion, selected writer) on a future live
run so the cause could be isolated. The current ACT has isolated
the cause (`getActiveRuntimeToolNames` reading a stale subset) and
applied the bounded repair. Per the BCB-CAPTURE01 ACT's
REMOVAL_TRIGGER contract, the following MUST be removed TOGETHER
in a successor cleanup ACT:

1. `apps/vscode/src/shared/bcb-observation-unavailable-capture.ts`
2. `apps/vscode/src/sdk/bcb-observation-unavailable-capture-runtime.ts`
3. `apps/vscode/src/sdk/__tests__/bcb-observation-unavailable-capture.bcapt01.test.ts`
4. `apps/vscode/src/sdk/__tests__/bcb-observation-unavailable-dogfood-profile-activation.bcbcap01.test.ts`
5. The diagnostic recorder call sites in
   `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`
   (1 import + 1 captured-locals declaration + 3 invocation sites).
6. The activation wiring in
   `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts`
   (1 import + 1 contract block + 1 narrow type + 1 helper).
7. The activation call in `apps/vscode/src/extension.ts`
   (1 import + 1 activation call + 1 status log).
8. The 2 command contributions + constants in
   `apps/vscode/package.json` + `apps/vscode/src/registry.ts`.
9. The `.factory/evidence/ACT-CLINEMM-BCB-CAPTURE01/live-captures/`
   and `.factory/evidence/ACT-CLINEMM-BCB-OBSERVABILITY-REPAIR01/live-captures/`
   directories.
10. The 1 biome.jsonc exclude line for `use-cache-service.grit`
    (mirroring the existing TSWPD / PTAD exclusions).

The cleanup ACT is **out of scope** for this ACT and must be a
separate, bounded successor — its scope is too large to fold in
without expanding the L2847 RED / BCB01 baseline verification cost.
The current ACT preserves all diagnostic machinery so the live
qualification in a writable environment can capture the post-repair
record (liveTools includes command_status → canObserveHeldResults=true
→ no BCB writer fires → phase=completed).

The post-repair capture record will be the empirical confirmation
that the repair lands cleanly on the live path. After the live
qualification resolves `LIVE_REPRODUCED` (or `LIVE_NO_REPRO`), the
cleanup ACT is unblocked.







