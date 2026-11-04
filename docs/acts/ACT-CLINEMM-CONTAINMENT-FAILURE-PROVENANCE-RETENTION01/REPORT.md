# ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 — Evidence Report

**Type:** Evidence acquisition / retention (diagnostics only)
**Status:** COMPLETE — structural verdict below
**Branch:** existing `main` (no ACT branch created)
**Production delta:** ONE bounded, diagnostic-only protected retention store inside the
EXISTING BJLA capture module, plus ONE companion dump artifact. **No process
termination, no job-state change, no containment-classification change, no continuation
scheduling change, no task-completion change, no new process signal, no new public API,
no wire/protocol field, no new environment toggle, no TaskHeader change, no new Command
Palette command.**

---

## 0. Terminal verdict

**`PASS_STRUCTURAL_READY_FOR_LIVE`**

The structural capability exists and is proven by a RED→GREEN reproduction against the
production capture seams: when a containment failure occurs and a later C10 completion
barrier holds on that job, a single BJLA dump still contains the **original failure
classification**, the **controller terminal publication**, and the **exact blocking-set
membership** — or explicitly reports why an element is unavailable — even after the
ordinary 256-record FIFO has wrapped many times over.

**LIVE status: NOT PERFORMED.** No VSIX was built, nothing was installed, and no LIVE
qualification is claimed. `PASS_STRUCTURAL_READY_FOR_LIVE` means *ready to be qualified*,
not *qualified*. The LIVE procedure is in
`.factory/evidence/ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01/08-live-qualification.md`.

**The defect that was closed.** The ordinary BJLA FIFO is bounded at 256 records. A
containment failure is classified **once**. After 256 further lifecycle events the
original kernel verdict, the OS errno and the launch-time owner are **evicted** — the
C10 blocking set still names the job id, but *why* the job is in the containment ledger
is no longer recoverable from any dump. This ACT keeps that evidence **outside** the
FIFO, bounded and with explicit loss accounting.

---

## 1. Entry HEAD, tree and repository hygiene

| Property | Value |
|---|---|
| `ENTRY_HEAD` | `75b8c6f8ae279c4bc5118c065bcb80f754ef6314` |
| `ENTRY_TREE` | `a93be231b132e626c534dc6b29a7e63828199c47` |
| `SUBJECT_HEAD` | see §9 (the exact commit of this ACT's source) |
| Branch | `main` |
| Protected stash | `stash@{0}: WIP on main: d46223b51 …` — **INTACT, untouched** |
| Worktrees | 3, all untouched |
| `PUSHED` | NO |
| `INSTALLED` | NO (no VSIX built, no dogfood install) |
| `BRANCH_CREATED` | NO |
| Unexpected tracked dirt | NONE — the tree was clean at entry (`git status --porcelain=v1 --untracked-files=all` was empty) |

The stash was **probed** (a temporary `git stash push`/`pop` pair) to measure the
untouched baseline failure set for §7. The protected stash was never popped, rewritten
or reordered; the temporary probe stash was dropped immediately after the measurement,
leaving `stash@{0}` exactly as it was found.

---

## 2. Source boundaries — what was actually inspected before editing

| File | Existing responsibility | Changed? |
|---|---|---|
| `apps/vscode/src/sdk/background-job-liveness-authority.ts` | BJLA types, capture switch, 256-record FIFO | **YES** — the protected store lives here |
| `apps/vscode/src/sdk/background-job-liveness-authority-runtime.ts` | Existing BJLA dump command implementation | **YES** — the companion artifact is written here |
| `apps/vscode/src/sdk/command-job-manager.ts` | `containment_failure_classified` producer | **NO** — untouched |
| `apps/vscode/src/sdk/SdkController.ts` | `containment_terminal_state_published` producer | **NO** — untouched |
| `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` | `containment_ledger_blocking_set` producer | **NO** — untouched |
| `apps/vscode/src/sdk/dogfood-diagnostic-profile.ts` | Existing default-off/dogfood-on activation | **NO** — untouched |
| `apps/vscode/src/extension.ts` | Command Palette registration of the dump | **YES** — the message now names the companion artifact |

**The producers were NOT rebuilt.** The protected store is fed from the SINGLE existing
capture seam (`captureBackgroundJobLivenessAuthorityRecord`), which already dispatches on
the `event` discriminator and already carries the `captureEnabled` guard. That is why
the three producer files are byte-for-byte unchanged.

Exact method / type names confirmed at HEAD:

- `captureBackgroundJobLivenessAuthorityRecord(record: BackgroundJobLivenessAuthorityRecord): void`
- `getBackgroundJobLivenessAuthorityCaptureRecords(): readonly BackgroundJobLivenessAuthorityRecord[]`
- `clearBackgroundJobLivenessAuthorityCaptureRecords(): void`
- `setBackgroundJobLivenessAuthorityCaptureBufferSize(size: number): void`
- `setBackgroundJobLivenessAuthorityCaptureEnabled(enabled: boolean): void`
- `isBackgroundJobLivenessAuthorityCaptureEnabled(): boolean`
- `dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic(context): Promise<{file, recordCount}>`
- Record types: `BackgroundJobLivenessAuthorityContainmentFailureClassifiedRecord`,
  `BackgroundJobLivenessAuthorityContainmentTerminalStatePublishedRecord`,
  `BackgroundJobLivenessAuthorityContainmentLedgerBlockingSetRecord`,
  `ContainmentOwnershipClass`, `ContainmentOsErrorCode`
- Producer seams: `CommandJobManager.finalize()` (the `containment_failure_classified`
  capture), `SdkController.updateBackgroundCommandState()` (the
  `containment_terminal_state_published` capture),
  `SdkSessionEventCoordinator.captureContainmentLedgerBlockingSet()` (the
  `containment_ledger_blocking_set` capture).


### BJLA test inventory reused

- `background-job-liveness-authority.bclas01.test.ts` … `bclas06.test.ts` (6 suites) —
  the existing BJLA ring / identity / default-off infrastructure.
- `containment-ledger-causal-recon01.clcr01.test.ts` (CLCR01, 20 tests) — the
  **directly reused** harness: the fake-supervisor `terminalPostconditionProbe` seam,
  the `startJobAndRunToTerminal` helper, the real `SdkSessionEventCoordinator` harness
  (`makeCoordinatorHarness`), and the real C10 completion-turn driver
  (`emitCompletionTurn`).
- `containment-failure-c10-authority01.cfc10a01.test.ts` (19 tests) and
  `containment-failure-c10-authority-repair01.cfc10ar01.test.ts` (25 tests) — the
  adjacent C10 authority suites.
- `premature-handoff-containment-failure01.phcf01.test.ts` (10 tests) and
  `pcpc-containment-product-contract.pcpc01.test.ts` (11 tests).

The new suite reuses that infrastructure rather than re-inventing it: the same
`makeSupervisorDouble` fake-supervisor shape, the same
`terminalPostconditionProbe` object form (`{postcondition, osErrorCode}`), the same
coordinator option wiring.

---

## 3. The design

### 3.1 The protected store

The store lives in `background-job-liveness-authority.ts` next to the ring it protects.
It is fed from the single existing capture seam, so it is armed and disarmed together
with the ring — there is no second activation path and no new environment toggle.

**Per job** (keyed by EXACT `jobId`):

- `failureRecord` — the ORIGINAL `containment_failure_classified` observation, preserved
  exactly as captured (including `postcondition`, `osErrorCode`, `containmentFailed`,
  `ownerSessionId`, `pid`, `pgid`, `managerInstance`, `hostInstance`, `capturedAt`).
  It is **never** overwritten by a later publication or an unrelated lifecycle event.
- `terminalPublicationRecord` — the ASSOCIATED `containment_terminal_state_published`
  record, retained **only** when `publishedState === "containment_failed"`.

Null and unavailable fields are preserved exactly as captured. Nothing is reconstructed
from later runtime state.

**Blocking sets**: the most recent NONEMPTY `containment_ledger_blocking_set`
observations, preserving `activeSessionId`, `boundary`, `blockingJobIds`,
`blockingOwnershipClasses`, `totalContainmentFailureEntries`,
`foreignOwnerEntriesExcluded`, `capturedAt`. The record does not carry a task id or an
epoch, so the lifecycle correlation is classified **`UNOBSERVED`** rather than invented.

### 3.2 Bounds and eviction

| Bound | Default | Behaviour on overflow |
|---|---|---|
| Ordinary BJLA FIFO | **256 (UNCHANGED)** | ordinary FIFO eviction — unchanged |
| `MAX_PROTECTED_JOBS` | 128 | evict the **OLDEST** protected job (insertion order); count `protectedJobEvictions` and `protectedRecordEvictions` |
| `MAX_PROTECTED_BLOCKING_SESSIONS` | 4 | evict the **OLDEST** blocking-set snapshot; count `blockingSetEvictions` |
| Blocking-set job ids per snapshot | 64 | **TRUNCATE** and report the EXACT omitted ids; count `blockingSetTruncations` |

The protected-job eviction policy is deterministic and preserves the **newest** relevant
evidence. A truncated blocking set is never presented as complete: the snapshot carries
`truncated: true`, `originalBlockingJobCount`, `retainedBlockingJobCount` and the
verbatim `omittedBlockingJobIds`.

There is **no unbounded tombstone map and no secondary index** — an evicted job is
removed from the map entirely.

### 3.3 Default-off behaviour

When the BJLA capture is disabled:

- **no** protected-record insertion,
- **no** diagnostic map mutation,

### 3.4 The dump contract

The existing command `cline.debug.dumpBackgroundJobLivenessAuthority` is **extended**,
not replaced. It now writes **two** artifacts:

```text
background-job-liveness-authority.jsonl              (ORIGINAL — format and consumers UNCHANGED)
background-job-liveness-authority.provenance.json     (NEW companion)
```

The companion's shape:

```json
{
  "schemaVersion": 1,
  "captureEnabled": true,
  "captureGeneration": 3,
  "protectedJobs": [],
  "blockingSets": [],
  "coverage": [],
  "loss": {
    "protectedJobEvictions": 0,
    "protectedRecordEvictions": 0,
    "blockingSetEvictions": 0,
    "blockingSetTruncations": 0
  },
  "bounds": {
    "maxProtectedJobs": 128,
    "maxProtectedBlockingSessions": 4,
    "maxBlockingSetJobIds": 64
  }
}
```

`captureGeneration` advances every time the capture seam is **armed**, so a dump can
distinguish a capture-disabled or post-restart gap from a capture that simply observed
nothing.

**Dump != clear.** The dump never mutates, resets or consumes the protected store, and
the snapshot carries no wall-clock timestamp of its own, so repeated dumps with no new
events produce **byte-identical** artifacts (CFPR01-10).

Each `coverage[]` entry identifies a retained blocking job and classifies the
availability of the original failure record, the controller terminal publication and the
blocking-set membership, using:

```text
JOIN_COMPLETE | JOIN_INCOMPLETE | UNAVAILABLE_FROM_TRACE
```

A missing record is reported as missing. It is **never** evidence of a successful
cleanup.

The artifact does **NOT** declare the task `CAPTURE_SUFFICIENT` merely because the
job-level join is complete: the flight-recorder and process-liveness evidence have
independent coverage, and the companion artifact says nothing about either.

---

## 4. RED → GREEN reproduction

### 4.1 The RED (before the implementation existed)

The focused suite is
`apps/vscode/src/sdk/__tests__/containment-failure-provenance-retention01.cfpr01.test.ts`.

RED run — the suite was written FIRST and executed against the untouched production
tree:

```text
 Test Files  1 failed (1)
      Tests  14 failed (14)
TypeError: clearBackgroundJobLivenessAuthorityProvenanceStore is not a function.
```

**RED-01 reproduced.** The defect is not hypothetical: CFPR01-02 drives a REAL
`CommandJobManager` containment failure through the documented
`terminalPostconditionProbe` seam, emits 300 unrelated BJLA lifecycle observations
through the production capture seam, and asserts that the original
`containment_failure_classified` record is **no longer present** in the ordinary
256-record FIFO. It was. The evidence was destroyed.

Had the RED failed to reproduce, the ACT would have been `HALT_RED_NOT_REPRODUCED`.
It reproduced, so the ACT continued.

### 4.2 The GREEN

After the protected store was implemented:

```text
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

### 4.3 RED-01 — ordinary FIFO eviction loses the cause, the dump does not

| Test | What it proves |
|---|---|
| CFPR01-01 | a REAL `CommandJobManager` classifies a real containment failure (`eperm` / `EPERM` / `substrate_eperm`), owner `session-cfpr01` |
| CFPR01-02 | after 300 ordinary events the original failure record **IS gone** from the ordinary FIFO (the defect) |
| CFPR01-03 | the companion dump **STILL** recovers the original verdict, errno, structured failure and owner — asserted against the **persisted artifact on disk**, not the in-memory structure |

### 4.4 RED-02 — the C10 completion boundary joins to the retained provenance

| Test | What it proves |
|---|---|
| CFPR01-04 | the C10 blocker id **EQUALS** the retained failure job id **EQUALS** the retained terminal-publication job id; the source's owner identity is preserved. Driven through the REAL `SdkSessionEventCoordinator` completion-attempt boundary. |
| CFPR01-05 | a FOREIGN owner's job is **not** a blocker and is **not** misclassified as a current-session blocker |
| CFPR01-06 | an UNKNOWN owner blocks (fail-closed) and stays explicitly `unknown_owner`; the join is honestly **not** `JOIN_COMPLETE` |

**Honesty note.** The controller terminal publication in CFPR01-04 is an **INJECTED
CONTROLLER PROJECTION**: the record shape and the capture seam are production, but the
`SdkController` instance itself is not constructed in this suite. The coordinator that
consumes it and classifies the blocker IS real. The suite says so in its own header.

### 4.5 RED-03 — overflow honesty

| Test | What it proves |
|---|---|
| CFPR01-07 | the store never grows without bound; the loss is **reported** (`protectedJobEvictions > 0`); the NEWEST evidence is preserved |
| CFPR01-08 | a missing required record is `UNAVAILABLE_FROM_TRACE`, **not** `JOIN_COMPLETE`; **no** postcondition and **no** errno are manufactured |
| CFPR01-09 | an unusually large blocking set is TRUNCATED with the **exact** omitted ids (`["big-c","big-d"]`) and counted in `loss.blockingSetTruncations` |

- **no** identity allocation attributable to this feature,
- **no** process or runtime-state change.

The store is fed exclusively from `captureBackgroundJobLivenessAuthorityRecord`, whose
first statement is `if (!captureEnabled) return`. The existing
`applyBackgroundJobLivenessAuthorityDiagnosticProfile(isDogfood)` resolver in
`dogfood-diagnostic-profile.ts` is **reused unchanged** — dogfood ON, public default

---

## 5. The GATES

| Gate | Required assertion | Test(s) | Result |
|---|---|---|---|
| G1 | Failure provenance survives more than 256 ordinary events | CFPR01-03, CFPR01-04 | PASS |
| G2 | Original failure verdict and errno preserved exactly | CFPR01-01, CFPR01-03, CFPR01-16 | PASS |
| G3 | Controller publication joined by job ID | CFPR01-04 | PASS |
| G4 | C10 blocker ownership and exact ID remain distinguishable | CFPR01-04, CFPR01-06 | PASS |
| G5 | Foreign-owner jobs are not misclassified as current-session blockers | CFPR01-05 | PASS |
| G6 | Unknown ownership remains explicitly unknown | CFPR01-06 | PASS |
| G7 | More failures than the protected capacity produce honest loss accounting | CFPR01-07 | PASS |
| G8 | Repeated dumps are identical when no new events occur, apart from legitimate dump metadata | CFPR01-10 | PASS |
| G9 | Non-dogfood capture remains `DEFAULT_OFF` | CFPR01-11, CFPR01-17 | PASS |
| G10 | No state-machine, job-lifecycle, or process-supervision delta | CFPR01-14/15/16/17 + the `git diff` (no producer file touched) | PASS |
| G11 | Empty and partially populated captures report incomplete evidence honestly | CFPR01-06, CFPR01-08, CFPR01-12 | PASS |
| G12 | No real process signals are added by the instrumentation | CFPR01-14 (source assertion: no `process.kill(`, `killpg`, `child_process`, `execSync`/`spawnSync`) | PASS |

The focused suite is **17 tests**, all GREEN.

---

## 6. Necessity / ablation (ACT §9)

The full ablation record is in
`.factory/evidence/ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01/06-ablation.txt`.

| Leg | Arm | Production outcome | Provenance after 300 ordinary events |
|---|---|---|---|
| 1 | ABLATED — protected capacity 0 | `containment_failed` (UNCHANGED) | **GONE** (`protectedJobs` empty, `protectedJobEvictions > 0`) |
| 2 | RETAINED — protected capacity 128 | `containment_failed` (UNCHANGED) | **SURVIVES** (`postcondition: "eperm"`, `osErrorCode: "EPERM"`) |
| 3 | DIAGNOSTIC CAPTURE DISABLED | `containment_failed` (IDENTICAL) | nothing retained (`captureEnabled: false`) |

The necessary intervention is **retaining evidence**, not changing the safety policy.
The ablation never disables containment enforcement — in every arm the job reaches
`containment_failed` identically.

---

## 7. Verification

| Property | Value |
|---|---|
| `ENTRY_HEAD` | `75b8c6f8ae279c4bc5118c065bcb80f754ef6314` |
| `SUBJECT_HEAD` | §9 |
| Focused suite | `17 passed (17)` — CFPR01 |
| Adjacent suites | `112 passed (112)` across 13 files (CFPR01 + sample-artifact generator + BCLAS01–06 + CLCR01 + CFC10A01 + CFC10AR01 + PHCF01 + PCPC01) |
| CFC10 / PHCF / PCPC group | `65 passed (65)` across 4 files |
| RED outcome | **REPRODUCED** — `14 failed (14)`, the protected store did not exist |
| GREEN outcome | **PASS** — `17 passed (17)` |
| `bun run check-types` | **EXIT 0** (protos + `tsc --noEmit` + compat + webview) |
| Baseline diagnostics | none (the untouched baseline is also clean) |
| ACT-owned diagnostics | **none** |
| Biome lint + format | `Checked 5 files … No fixes applied.` (exit 0) |
| Full-suite baseline comparison | **IDENTICAL_FAILURE_SET** — 16 failing files in BOTH the ACT-owned run and the untouched-baseline run, with identical per-file failure counts |
| ACT-owned full-suite failures | **0** |
| `git status` | 5 ACT-owned source files + the evidence directory; the protected stash is INTACT |

The 16 pre-existing failures are macOS Seatbelt / sandbox environment artifacts of this
host. They occur identically with the ACT completely absent — that comparison is the
evidence, not an assertion. The per-file list is in
`.factory/evidence/ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01/07-baseline-comparison.txt`.

---

## 8. Sample BJLA provenance artifact

Generated by driving the REAL production seams
(`apps/vscode/src/sdk/__tests__/cfpr01-sample-artifact.gen.test.ts`); the artifact is
`.factory/evidence/ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01/02-sample-provenance.json`.

The headline fact:

```json
{
  "ordinaryFifoStillContainsFailureRecord": false,
  "companionProvenanceContainsFailureRecord": true,
  "ordinaryJsonlRecordCount": 256
}
```

The ordinary JSONL is full at exactly 256 records and **no longer contains the
failure record**. The companion artifact **does**, with the verdict and errno intact:

```json
"failureRecord": {
  "event": "containment_failure_classified",
  "jobId": "cmd_mw2lnwa99yi28t0e",
  "ownerSessionId": "session-1793817350459",
  "pid": 4242,
  "pgid": 4242,
  "postcondition": "eperm",
  "osErrorCode": "EPERM",
  "containmentFailed": "substrate_eperm",
  "jobState": "containment_failed"
},
"terminalPublicationRecord": {
  "event": "containment_terminal_state_published",
  "jobId": "cmd_mw2lnwa99yi28t0e",
  "publishedState": "containment_failed",
  "ownerSessionId": "session-1793817350459",
  "isContainmentFailure": true
}
```

and the coverage classification:

```json
"coverage": [
  {
    "jobId": "cmd_mw2lnwa99yi28t0e",
    "activeSessionId": "session-1793817350459",
    "boundary": "c10_completion_attempt",
    "blockingJobIds": ["cmd_mw2lnwa99yi28t0e"],
    "ownershipClass": "matching_owner",
    "failureRecordAvailability": "JOIN_COMPLETE",
    "terminalPublicationAvailability": "JOIN_COMPLETE",
    "blockingSetMembershipAvailability": "JOIN_COMPLETE",
    "postcondition": "eperm",
    "osErrorCode": "EPERM",
    "containmentFailed": "substrate_eperm",
    "ownerSessionId": "session-1793817350459"
  }
],
"loss": {
  "protectedJobEvictions": 0,
  "protectedRecordEvictions": 0,

---

## 9. Files changed and the exact source-level diff

### 9.1 Files changed (ACT-owned only)

| File | Change | Lines |
|---|---|---|
| `apps/vscode/src/sdk/background-job-liveness-authority.ts` | the protected provenance store, its types, bounds, eviction and coverage computation; the store is fed from the existing capture seam; `captureGeneration` bump on arm | `+563 / -1` |
| `apps/vscode/src/sdk/background-job-liveness-authority-runtime.ts` | the companion artifact is written next to the ORIGINAL JSONL; the original artifact and its consumers are untouched | `+27 / -3` |
| `apps/vscode/src/extension.ts` | the dump command's information message now names the companion artifact | `+3 / -2` |
| `apps/vscode/src/sdk/__tests__/containment-failure-provenance-retention01.cfpr01.test.ts` | **NEW** — the focused regression suite (17 tests) | 747 |
| `apps/vscode/src/sdk/__tests__/cfpr01-sample-artifact.gen.test.ts` | **NEW** — the evidence generator that produces the sample artifact through the real seams | 151 |

The full source-level diff of the three modified files is in
`.factory/evidence/ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01/05-source-diff.patch`.

### 9.2 The essential diff

```diff
--- a/apps/vscode/src/sdk/background-job-liveness-authority.ts
+++ b/apps/vscode/src/sdk/background-job-liveness-authority.ts
@@
 export function setBackgroundJobLivenessAuthorityCaptureEnabled(enabled: boolean): void {
-	captureEnabled = Boolean(enabled)
+	const next = Boolean(enabled)
+	// ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01):
+	// the capture GENERATION advances every time the seam is ARMED, so
+	// a dump can distinguish "capture was never armed in this process"
+	// from "capture was armed and observed nothing". The generation is
+	// diagnostic-only; it never feeds back into the runtime.
+	if (next && !captureEnabled) {
+		captureGeneration += 1
+	}
+	captureEnabled = next
 }
@@
 export function captureBackgroundJobLivenessAuthorityRecord(record: BackgroundJobLivenessAuthorityRecord): void {
 	if (!captureEnabled) return
 	buffer.push(record)
 	if (buffer.length > bufferSize) {
 		buffer.shift()
 	}
+	captureProvenanceRecord(record)
 }
```

plus the new protected-store section: the types
(`BackgroundJobLivenessAuthorityProvenanceJob`,
`BackgroundJobLivenessAuthorityProvenanceBlockingSet`,
`BackgroundJobLivenessAuthorityProvenanceCoverage`,
`BackgroundJobLivenessAuthorityProvenanceLoss`,
`BackgroundJobLivenessAuthorityProvenanceSnapshot`,
`BackgroundJobLivenessAuthorityProvenanceAvailability`), the bounds
(`DEFAULT_MAX_PROTECTED_JOBS = 128`,
`DEFAULT_MAX_PROTECTED_BLOCKING_SESSIONS = 4`,
`DEFAULT_MAX_BLOCKING_SET_JOB_IDS = 64`), the state
(`protectedJobs`, `protectedBlockingSets`, `provenanceLoss`, `captureGeneration`), the
helpers (`ensureProtectedJobEntry`, `enforceProtectedJobCapacity`, `retainBlockingSet`,
`captureProvenanceRecord`, `computeCoverage`) and the exported surface
(`getBackgroundJobLivenessAuthorityProvenanceSnapshot`,
`clearBackgroundJobLivenessAuthorityProvenanceStore`,
`setBackgroundJobLivenessAuthorityProvenanceBounds`).

  "blockingSetEvictions": 0,
  "blockingSetTruncations": 0
}
```

```diff
--- a/apps/vscode/src/sdk/background-job-liveness-authority-runtime.ts
+++ b/apps/vscode/src/sdk/background-job-liveness-authority-runtime.ts
@@
-const DUMP_FILE = "background-job-liveness-authority.jsonl"
+const DUMP_FILE = "background-job-liveness-authority.jsonl"
+
+/**
+ * ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01).
+ *
+ * The COMPANION provenance artifact. It sits NEXT TO the original JSONL
+ * (which keeps its exact format and consumers) and carries the
+ * protected retention that survives the ordinary 256-record FIFO wrap.
+ */
+const PROVENANCE_DUMP_FILE = "background-job-liveness-authority.provenance.json"
@@
-): Promise<{ file: string; recordCount: number }> {
+): Promise<{ file: string; recordCount: number; provenanceFile: string }> {
@@
+	// ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 (CFPR01):
+	// the COMPANION provenance artifact. It is written UNCONDITIONALLY
+	// (the operator must be able to inspect whatever was captured even
+	// after the diagnostic was disabled) and it does NOT clear the
+	// protected store (dump != clear).
+	//
+	// The serialization is STABLE: the snapshot contains no wall-clock
+	// timestamp of its own, so repeated dumps with no new events produce
+	// byte-identical artifacts.
+	const provenanceFile = join(dir, PROVENANCE_DUMP_FILE)
+	const provenance = getBackgroundJobLivenessAuthorityProvenanceSnapshot()
+	await writeFile(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`, "utf8")
+	return { file, recordCount: records.length, provenanceFile }
 }
```

```diff
--- a/apps/vscode/src/extension.ts
+++ b/apps/vscode/src/extension.ts
@@
-				const { file, recordCount } = await dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic(context)
+				const { file, recordCount, provenanceFile } = await dumpExtensionSideBackgroundJobLivenessAuthorityDiagnostic(context)
 				void vscode.window.showInformationMessage(
-					`Background job liveness authority diagnostic: ${recordCount} record${recordCount === 1 ? "" : "s"} → ${file}.`,
+					`Background job liveness authority diagnostic: ${recordCount} record${recordCount === 1 ? "" : "s"} → ${file} (+ ${provenanceFile}).`,
 				)
```

### 9.3 What is NOT in the diff

- `command-job-manager.ts` — **not touched**. No `process.kill`, no `killpg`, no shell
  probe, no job-state mutation, no `backgroundCommandJobStates` change.
- `SdkController.ts` — **not touched**.
- `sdk-session-event-coordinator.ts` — **not touched**. No BCB predicate change, no Elm
  authority change.
- `dogfood-diagnostic-profile.ts` — **not touched**. The EXISTING `captureEnabled` seam
  and the EXISTING dogfood resolver are reused. No new environment toggle.
- No `proto/` change, no generated code change, no webview/React change, no
  TaskHeader change, no new Command Palette command, no `package.json` command
  declaration change, no new public API.


The blocking-set snapshot also carries `"taskEpochCorrelation": "UNOBSERVED"` — the
original BJLA record does not carry a task or epoch identity, and none is invented.

OFF.


---

## 10. LIVE qualification status

**NOT PERFORMED.** No VSIX was built, nothing was installed, and no dogfood run was
performed by this ACT. The full procedure, the artifact-identity template, the join
procedure and the honest result classification are in
`.factory/evidence/ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01/08-live-qualification.md`.

The structural verdict `PASS_STRUCTURAL_READY_FOR_LIVE` asserts exactly one thing: the
capability to join a C10 blocker back to its ORIGINAL cleanup evidence from a single
BJLA dump — after FIFO eviction — **exists, is bounded, is honest about its own loss,
and has been proven against the real capture seams**. It does **not** assert that any
particular LIVE occurrence has been joined.

### What is deliberately NOT claimed

- The four LIVE blockers from the 2026-11-04 capture
  (`cmd_mw2gknnryrnqwcmw`, `cmd_mw2h9j8n9ncptte7`, `cmd_mw2hb1nm5rp9fr8j`,
  `cmd_mw2hcxbjse0zbl22`) keep their `UNAVAILABLE_FROM_TRACE` status. Their original
  cleanup postconditions and OS errors are **not** reconstructed, and `substrate_alive`
  / `substrate_eperm` / a later successful cleanup are **not** inferred for them. The
  protected recorder cannot retroactively recover what that capture did not observe.
- A `JOIN_COMPLETE` job-level provenance join does **not** prove the process group is
  currently alive or gone. The retained record is the ORIGINAL observation.
- The task is **not** declared `CAPTURE_SUFFICIENT`: the flight-recorder and
  process-liveness evidence have independent coverage.

---

## 11. Removal and continuation

The protected store is temporary forensic instrumentation, not permanent architecture.

**Removal trigger** — the first of:

1. the containment failure's root cause is isolated;
2. the LIVE capture remains insufficient and this recorder cannot safely close the gap;
3. successor evidence supersedes the protected recorder.

Do **not** remove the recorder before any required bounded repair has been
LIVE-qualified. When it is removed, these MUST go TOGETHER (mirroring the BJLA
removal contract):

- the protected store section in `background-job-liveness-authority.ts`;
- the companion artifact in `background-job-liveness-authority-runtime.ts`;
- the `provenanceFile` mention in `extension.ts`;
- the two new test files;
- this report and the evidence directory.

The **existing** BJLA ring, its 256-record bound, the dump command and its
`background-job-liveness-authority.jsonl` artifact are **NOT** part of this ACT and
survive the removal of the protected store.

**Continuation after a successful LIVE join.** The next ACT may investigate or repair
process containment, but only with:

```text
REAL failure
  → causal classification
  → RED reproduction
  → necessity/ablation
  → bounded repair
  → adversarial conservation tests
  → exact-head artifact
  → LIVE qualification
```

If later containment is unobservable without new process probes, stop at
`LIVE_UNOBSERVABLE`; do not infer successful cleanup from historical data.

---

## 12. Evidence index

`.factory/evidence/ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01/`

| File | Contents |
|---|---|
| `01-entry-state.txt` | ENTRY_HEAD, ENTRY_TREE, branch, stash/worktree hygiene, push/install flags |
| `02-sample-provenance.json` | the sample companion artifact + the FIFO-vs-companion headline fact |
| `03-red.txt` | the RED run: `14 failed (14)` |
| `04-green.txt` | the GREEN run: `112 passed (112)` across 13 files |
| `05-source-diff.patch` | the exact source-level diff of the three modified files |
| `06-ablation.txt` | the three-leg necessity/ablation record |
| `07-baseline-comparison.txt` | the untouched-baseline comparison (16 identical failing files) and the typecheck/lint results |
| `08-live-qualification.md` | the LIVE procedure, artifact-identity template and result classification |
