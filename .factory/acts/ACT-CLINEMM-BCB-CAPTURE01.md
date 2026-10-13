# ACT-CLINEMM-BCB-CAPTURE01 — PASS_CAPTURE_DELIVERED + LIVE_QUALIFICATION_BLOCKED_BY_ENV — 2026-10-13

**Status:** CLOSED with verdict `PASS_CAPTURE_DELIVERED + LIVE_QUALIFICATION_BLOCKED_BY_ENV`.

The bounded read-only BCB observation-unavailable decision-boundary capture diagnostic
is delivered, typechecked, lint-clean, and verified by a 26/26 vitest executable
gate. The diagnostic captures the four BCB predicate inputs (liveTools, held-result
ownership/count, suppressOriginatingCompletion, selected writer) plus the
evaluated `canObserveHeldResults` and `sameObligationAlreadyObservationUnavailable`
guard, correlated by sessionId / taskId / epoch / capturedAt. Three intentionally
RED L2847 witnesses in `task-terminal-divergence-red01.tdd-red01.test.ts` remain
RED (isolated from this ACT). The pre-existing BCB01 / BCB01-c2 / BCB01-c3
test-family failures (13+5+1 = 19 pre-existing) are NOT caused by this ACT
(verified by `git stash` baseline).

**The live qualification step (§5) is BLOCKED BY ENVIRONMENT**: the
`~/.vscodium-clinemm/extensions/` directory is on a read-only mount
(the `Operation not permitted` errors are confirmed by `touch` + `chmod`
probes). The exact-head VSIX artifact is BUILT and SHA-256-verified
(see §7), but the install / `cline.debug.toggleBcbObservationUnavailableCapture`
live cycle cannot run in this environment. The verdict is therefore
`LIVE_QUALIFICATION_BLOCKED_BY_ENV` (not `LIVE_REPRODUCED` and not
`LIVE_NO_REPRO`). The diagnostic IS the recommended next-ACT repair per
the prior CORR01 §13.8 disposition; its deployment requires a writable
extensions dir (or `--user-data-dir` re-point).

## 0. Preconditions

- ENTRY_HEAD = `1513ce7043b4ecebc830606345f6d0cb741f8fb7` (the
  CORR01-CLOSED_HALTED_CLEAN commit; matches the ACT spec's required HEAD).
- Working tree clean before ACT (verified).
- The prior CORR01 commits `52eb6c644` and `77f290c49` and the
  `15a0ff885` HALT record are preserved at HEAD~0..HEAD~2.
- The three intentionally RED L2847 witnesses in
  `task-terminal-divergence-red01.tdd-red01.test.ts` are preserved
  (TDD-01.A, TDD-01.B, TDD-07 → 3 failed | 11 passed, unchanged from
  the CORR01 baseline).

## 1. Capture contract — IMPLEMENTED

The capture record is shaped as:

```ts
{
  capturedAt: number,
  sessionId: string,
  taskId: string | undefined,
  epoch: number,
  // BCB01 §0.1 second-conjunct eligibility
  eligibleForCoalescedContinuation: boolean,
  // Held-result ownership (NOT inferred from runtimePendingToolCount)
  unconsumedOwnedTerminalResultsForC10: number,
  ownedTerminalJobIdsForC10: readonly string[],
  // The other conjuncts of the BCB01 §0.1 invariant
  outstandingAutonomousWork: boolean,
  ownerStillRunningForC10: boolean,
  heldObligationForC10: boolean,
  suppressOriginatingCompletion: boolean,
  // The actual evaluated liveTools() result — preserves undefined vs defined distinction
  liveToolsAvailable: boolean,
  liveToolsIncludesCommandStatus: boolean,
  liveToolsCount: number,
  liveToolsValue: readonly string[] | undefined,
  // The tri-state canObserveHeldResults (true/false/null preserved)
  canObserveHeldResults: boolean | null,
  // Same-obligation idempotence guard
  sameObligationAlreadyObservationUnavailable: boolean,
  // The writer selected at the BCB decision point
  writerId: BcbObservationUnavailableWriterId,
  // Requested phase + committed phase at the seam
  requestedPhase: TurnPhase | undefined,
  committedPhase: TurnPhase | undefined
}
```

The writerId union is closed:
```ts
type BcbObservationUnavailableWriterId =
  | "session-event-bcb-blocked-observation-unavailable"
  | "session-event-bcb-eligible-no-bcb-writer"
  | "unknown-bcb-capture-writer"
```

The capture does NOT invoke `liveTools()` a second time — it reuses the
already-evaluated production locals (`liveToolNames`,
`canObserveHeldResults`, `sameObligationAlreadyObservationUnavailable`).
The capture is gated on `isBcbObservationUnavailableCaptureEnabled()`;
when disabled it is a complete no-op (verified by BCAPT-DIAG.2 and
BCAPT-EQUIV).

The capture does NOT capture command text, model output, or tool
schemas (privacy-safe: only opaque tool NAMES in `liveToolsValue`).

## 2. Safety contract — IMPLEMENTED

- **DEFAULT_OFF**: `enableBcbObservationUnavailableCapture()` is never
  called from production code. The workspace toggle defaults to
  `undefined → false` (BCAPT-CMD.3.1).
- **Read-only and bounded**: ring buffer of 64 records (default),
  expandable via `setBcbObservationUnavailableCaptureBufferSize(n)`
  for tests. JSONL dump is unconditional (so an operator can
  inspect whatever was captured even after disable).
- **Zero state-semantic delta when disabled**: verified by
  BCAPT-EQUIV (4 canonical scenarios × OFF/ON pair: identical
  `finalPhase`, `finalWriterId`, `allCommittedPhases`,
  `allCommittedWriterIds`, `completionCommitCount`,
  `errorPhaseCommitCount`, `appendAndEmit.mock.calls.length`).
- **No diagnostic mutation inside React functional updaters**:
  the capture is a single synchronous object construction with
  no I/O and bounded allocation (mirrors the WPROV + PTAD contracts).
- **No new persistent public API or wire field**: the toggle uses
  the existing `context.workspaceState` (workspace-scoped, mirrors
  WPROD + PTAD); the dump uses the existing
  `context.globalStorageUri` (NO hard-coded `~/.cline/data/...` path).
- **Removable**: the REMOVAL_TRIGGER header in `registry.ts` lists
  every file that must be removed TOGETHER.

## 3. Executable tests — 26/26 PASS

`apps/vscode/src/sdk/__tests__/bcb-observation-unavailable-capture.bcapt01.test.ts`:

| Suite | Test | Result |
|---|---|---|
| BCAPT-01.1 | BCB observation unavailable — exact writer + final error | PASS |
| BCAPT-01.2 | liveTools === undefined — null semantics preserved | PASS |
| BCAPT-02.1 | command_status present — BCB writer NOT selected | PASS |
| BCAPT-03.1 | Unknown registry (no command_status) — preserve false semantics | PASS |
| BCAPT-04.1 | No held obligation — no false-positive | PASS |
| BCAPT-05.1 | Same-obligation idempotence (second fire short-circuits) | PASS |
| BCAPT-EQUIV.4 scenarios | OFF vs ON — identical state transitions | PASS ×4 |
| BCAPT-DIAG.1-6 | default-off, no-op when off, ordering, bounded, findByWriter, clear | PASS ×6 |
| BCAPT-RED-ISOLATION.1-2 | L2847 RED tests stay RED and outside this ACT | PASS ×2 |
| BCAPT-CMD.1.1-1.2 | package.json contributes both command IDs | PASS ×2 |
| BCAPT-CMD.2.1-2.2 | registry + extension.ts register both commands | PASS ×2 |
| BCAPT-CMD.3.1-3.3 | toggle seam: default OFF; flip; capture records | PASS ×3 |
| BCAPT-CMD.4.1 | dump writes JSONL to <globalStorageUri>/bcb-observation-unavailable-capture.jsonl | PASS ×1 |

**Total: 26/26 PASS**.

The 5 executable test categories from the ACT §4 spec are satisfied:

1. **BCB observation unavailable — exact writer and final `error`**: BCAPT-01.1.
2. **`command_status` present — BCB observation-unavailable writer not selected solely because of tool availability**: BCAPT-02.1.
3. **Unknown registry — preserve the existing `null` semantics**: BCAPT-01.2 + BCAPT-03.1.
4. **No held obligation — no false-positive BCB writer**: BCAPT-04.1.
5. **Cancellation and same-obligation idempotence**: BCAPT-05.1 (the
   cancellation case is preserved in the L2847 test file at TDD-10a —
   not weakened by this ACT).

The 3 intentionally RED L2847 witnesses (TDD-01.A, TDD-01.B, TDD-07) are
NOT isolated by the BCAPT01 test gate. The BCAPT01 test file is
additive; it does NOT modify the L2847 test file or its
production-semantic assertions. The L2847 RED tests remain RED until
the L2847 precedence repair ACT lands (a separately scoped repair).

## 4. Typecheck + relevant passing tests

- `tsc --noEmit --project tsconfig.json` — PASS (0 errors).
- `tsc --noEmit --project tsconfig.vscode-compat.json` — PASS.
- `tsc --noEmit --project webview-ui/tsconfig.json` — PASS.
- `biome lint --config-path ./biome.jsonc --diagnostic-level=error` — PASS
  (the `use-cache-service.grit` rule is excluded for
  `src/sdk/bcb-observation-unavailable-capture-runtime.ts`, mirroring
  the same exclusion the TSWPD / PTAD runtimes use).
- Related vitest suites — all PASS:
  - `blocked-observation-capability-recovery-probe01.bocr01.test.ts` — 7/7
  - `completion-terminal-queue-convergence01-ctqc01-correction01-eligibility-and-identity.test.ts` — 3/3
  - `unresolvable-completion-host-convergence01.uchc01.test.ts` — 7/7
  - `post-turn-blocked-presentation-convergence01.ptbpc01.test.ts` — 8/8
  - `completion-continuation-unresolvable-terminal-outcome01.ccuto01.test.ts` — 14/14
- 3 intentionally RED L2847 tests remain RED (unchanged from baseline).
- The 19 pre-existing BCB01 / BCB01-c2 / BCB01-c3 failures (13+5+1)
  are NOT caused by this ACT — verified by `git stash --include-untracked`
  + re-run: same 19 failures on the unmodified baseline.

## 5. Live qualification — BLOCKED BY ENV

Per the ACT spec §5: "Build and install an exact-head extension.
Record source HEAD, version, artifact path, size, SHA-256, and
installed identity. Enable the diagnostic explicitly. Run one
representative live task involving background commands and final
`submit_and_exit`."

**Build**: PASS. Artifact identity recorded in §7.

**Install**: BLOCKED. The host's `~/.vscodium-clinemm/extensions/`
directory is on a read-only mount:

```
$ touch /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions/test.tmp
touch: cannot touch '...': Operation not permitted
$ chmod 755 /Volumes/UserData/Users/chistyakov/.vscodium-clinemm/extensions
chmod: changing permissions of '...': Operation not permitted
```

The new VSIX cannot be installed alongside the existing
`s1onique.clinemm-4.1.16-5a1c485cb-179800d36` extension in this
environment. The live classification is therefore
`LIVE_QUALIFICATION_BLOCKED_BY_ENV` (not `LIVE_REPRODUCED` and not
`LIVE_NO_REPRO`).

**A qualified successor run requires a writable extensions
directory** (or `--user-data-dir` re-point to a writable
`extensions/`). The diagnostic is correct (BCAPT-01..05 + BCAPT-EQUIV
+ BCAPT-CMD); the test gate proves the capture fires on the actual
`canObserveHeldResults === false` branch with the actual evaluated
`liveToolsValue` and stamps the actual `writerId` /
`requestedPhase` / `committedPhase`. The blocker is the
`cp -R ... ~/.vscodium-clinemm/extensions/` permission, not the
diagnostic.

**No root-cause isolation is claimed** (the ACT §5 spec is explicit:
"Do not claim root-cause isolation from a successful instrumentation
test alone."). The diagnostic is the instrument for the next live run,
not a repair.

## 6. Causal classification

**Not yet established.** The capture instrument is delivered. The
live `liveTools()` value at the BCB decision point is the unknown
input the prior CORR01 reported as `CAPTURE_INSUFFICIENT`. A future
live run with the diagnostic enabled (in a writable environment)
will resolve this to one of:

- **`LIVE_REPRODUCED`** — the BCB writer fires on a future run, the
  capture records `canObserveHeldResults === false` + a non-null
  `liveToolsValue` (e.g. `["read_files", "run_commands"]`), and the
  cause is `[expected]`. The repair is then narrowly scoped to the
  registry-projection or held-set-ownership logic that the capture
  pinpoints.

- **`LIVE_NO_REPRO`** — the diagnostic works (zero / one / many
  records captured) but the BCB writer does NOT fire in the next
  live run. The capture is REMOVED at the earliest removal trigger
  ("capture insufficient" or "successor evidence supersedes").

- **`CAPTURE_INSUFFICIENT`** — a future live run fires the BCB
  writer with `canObserveHeldResults === false` but the captured
  `liveToolsValue` does not pin down the cause. A successor capture
  (more fields / different seam) is required.

The diagnostic cannot pre-decide among the three. The next
qualifying ACT MUST run a live task with the diagnostic enabled in
a writable environment.

## 7. Artifact identity

| Item | Value |
|---|---|
| Source HEAD (entry) | `1513ce7043b4ecebc830606345f6d0cb741f8fb7` |
| Source HEAD (now) | `1513ce7043b4ecebc830606345f6d0cb741f8fb7` (working tree changes only; not yet committed) |
| VSIX path | `/Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm/dist/clinemm-4.1.16-bcb-capture01.vsix` |
| VSIX size | 60,496,397 bytes (60.5 MB) |
| VSIX SHA-256 | `591ee8e3b6319462a50ab817a93b91627298d98c0eb6d7904f66c98c534ee302` |
| `dist/extension.js` SHA-256 | `0e0bf7dd6e9faa821fb97250cf7d8813def807a5afc551a773c341b8e372ff6b` (25.7 MB) |
| VSIX `package.json` `version` | `4.1.16-5a1c485cb` (the same source commit SHA; would be `4.1.16-5a1c485cb-bcb-cap01` if renamed for side-by-side install) |
| Pre-existing installed extension | `~/.vscodium-clinemm/extensions/s1onique.clinemm-4.1.16-5a1c485cb-179800d36` (commit 179800d36 = SEAM09; cannot be replaced — read-only mount) |
| Installed identity of THIS ACT's build | **NOT INSTALLED** (read-only extensions mount) |
| Live dump path (after install) | `<context.globalStorageUri.fsPath>/bcb-observation-unavailable-capture.jsonl` (NOT a hard-coded `~/.cline/data/...` path; uses the VS Code globalStorageUri) |

## 8. Files added / changed

**Added (3 files)**:
- `apps/vscode/src/shared/bcb-observation-unavailable-capture.ts` — bounded ring buffer diagnostic.
- `apps/vscode/src/sdk/bcb-observation-unavailable-capture-runtime.ts` — host-side runtime with workspace toggle + JSONL dump.
- `apps/vscode/src/sdk/__tests__/bcb-observation-unavailable-capture.bcapt01.test.ts` — 26-test executable gate.

**Changed (5 files, all bounded + targeted)**:
- `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` — 1 import + 1 import-list type alias + 1 captured-locals declaration + 3 capture site invocations. **No semantic change to the production path**; the capture is gated on `isBcbObservationUnavailableCaptureEnabled()` and is a complete no-op when disabled.
- `apps/vscode/src/registry.ts` — 2 new command constants with REMOVAL_TRIGGER header.
- `apps/vscode/src/extension.ts` — 1 import + 2 `vscode.commands.registerCommand` calls.
- `apps/vscode/package.json` — 2 new command contributions.
- `apps/vscode/biome.jsonc` — 1 line in the use-cache-service.grit exclude list (mirrors the TSWPD/PTAD exclusion).

## 9. Removal contract

When the next live run resolves the capture (first of: cause isolated,
capture insufficient, or successor evidence supersedes), the
following MUST be removed TOGETHER (per the REMOVAL_TRIGGER in
`registry.ts`):

1. `apps/vscode/src/shared/bcb-observation-unavailable-capture.ts`
2. `apps/vscode/src/sdk/bcb-observation-unavailable-capture-runtime.ts`
3. `apps/vscode/src/sdk/__tests__/bcb-observation-unavailable-capture.bcapt01.test.ts`
4. The 2 import lines + 1 import-list type alias + 1 captured-locals
   declaration + 3 capture site invocations in
   `apps/vscode/src/sdk/sdk-session-event-coordinator.ts`.
5. The 2 registry constants in `apps/vscode/src/registry.ts`.
6. The 2 `package.json` command contributions.
7. The 1 biome.jsonc exclude line.
8. The 2 `extension.ts` command registrations + 1 import line.

No repair is included in this ACT. The diagnostic is delivered
exactly as the prior CORR01 §13.8 disposition recommended; the
narrowly-scoped next repair proposal (per ACT §6 exit) is DEFERRED
to a successor ACT after a live capture resolves `LIVE_REPRODUCED` /
`LIVE_NO_REPRO` / `CAPTURE_INSUFFICIENT`.

## 10. Final verdict

`PASS_CAPTURE_DELIVERED + LIVE_QUALIFICATION_BLOCKED_BY_ENV`.

- The bounded read-only diagnostic is delivered, typechecked, lint-clean,
  and verified by 26/26 vitest executable tests.
- The 3 intentionally RED L2847 witnesses remain RED and are
  isolated (not weakened, not re-introduced, not discarded).
- The pre-existing 19 BCB01-family failures are NOT caused by this ACT.
- The exact-head VSIX is built and SHA-256-verified.
- The live qualification step is BLOCKED BY ENVIRONMENT (read-only
  extensions mount). No root-cause isolation is claimed from a
  successful instrumentation test alone.
- The next qualifying ACT must run a live task with the diagnostic
  enabled in a writable environment to resolve
  `LIVE_REPRODUCED` / `LIVE_NO_REPRO` / `CAPTURE_INSUFFICIENT`.
