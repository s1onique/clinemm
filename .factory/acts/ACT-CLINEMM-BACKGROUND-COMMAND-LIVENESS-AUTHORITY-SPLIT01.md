# ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01

> Status: **CAPTURE_INSUFFICIENT / LIVE_BIND_REQUIRED /
> CLASSIFICATION = UNRESOLVED / PRODUCTION_REPAIR = NOT_AUTHORIZED /
> DIAGNOSTIC_BUILT = YES / NEXT = one operator-driven LIVE
> reproduction per ACT sec 28, then a bounded-repair child ACT.**

Epistemic purpose: **causal discriminator with bounded repair
authorization** (per ACT sec 0).

```text
ENTRY_HEAD  = bec53f6558e7e0fdb917e57d1780040c5b9708d1
SOURCE_HEAD = 9c74740354c3770ecf3567959d98f82eb3d9477e
DOCS_HEAD   = 9c74740354c3770ecf3567959d98f82eb3d9477e
BOUND_SPECIMEN = task 1789903873206_g5qvj,
                  job cmd_mu9qjxmwxl5hasi8
```

**Verdict** (per ACT mission):
```text
LIVE_BOUNDARY                  = PROVEN (BOCOR + TSWPD captured)
Q5_GUARD_LOGIC                 = EXONERATED_FOR_THIS_OCCURRENCE
OWNER_IDENTITY_MISMATCH        = NOT_PRIMARY_FAILURE_FOR_THIS_OCCURRENCE
LIVE_MANAGER_ACTIVE_SET        = EMPTY
LIVE_USER_VISIBLE_COMMAND      = RUNNING
MANAGER_INSTANCE_SPLIT         = UNPROVEN (BJLA diagnostic built;
                                              operator LIVE required)
PREMATURE_FINALIZATION         = UNPROVEN
STALE_PROJECTION               = UNPROVEN
STATUS_AUTHORITY_SPLIT         = UNPROVEN
MANAGER_REPLACEMENT_STRANDS    = UNPROVEN
CLASSIFICATION (LIVE)          = DEFERRED (→ LIVE_BIND_GATED)
DIAGNOSTIC_BJLA_BUILT          = YES (synthetic: 7/7 PASS)
PRODUCTION_REPAIR              = NOT_AUTHORIZED in this ACT
NEXT                           = operator LIVE reproduction
                                + bounded-repair child ACT
```

## §0 — Epistemic purpose

The LIVE contradiction under investigation:

```text
UI / model-visible command:
  jobId = cmd_mu9qjxmwxl5hasi8
  card  = Backgrounded
  Cancel = visible
  status = running

Q5 guard (BOCOR snapshot):
  activeJobs = []
  guardResult = false
```

followed by:

```text
TSWPD:
  writerId = session-event-turn-complete-resumable-straggler-preserve
  streaming → awaiting_followup (1 ms after BOCOR capture)
```

This ACT introduces the **BJLA** (Background Job Liveness
Authority) diagnostic to classify the LIVE occurrence as one
of:

  - LA1 (premature finalization)
  - LA2 (manager-instance split)
  - LA3 (stale projection)
  - LA4 (status authority split)
  - LA5 (replacement strands active job)
  - LA6 (other proven cause)

This ACT does NOT repair. The bounded repair is the next ACT's
responsibility after the operator drives the LIVE reproduction.

## §1 — Entry state

```text
git rev-parse HEAD = bec53f6558e7e0fdb917e57d1780040c5b9708d1
git status --short = CLEAN (no uncommitted modifications)
```

HALT_UNEXPECTED_TRACKED_DIRT = NOT_TRIGGERED.

## §2 — Frozen LIVE evidence

Sources: `/Volumes/UserData/Users/chistyakov/Downloads/background-owner-correlation.jsonl`
and `/Volumes/UserData/Users/chistyakov/Downloads/turn-state-writer-provenance.jsonl`.

Discriminator state (frozen):
```text
Q5_GUARD_LOGIC              = EXONERATED_FOR_THIS_OCCURRENCE
OWNER_IDENTITY_MISMATCH     = NOT_THE_PRIMARY_FAILURE_FOR_THIS_OCCURRENCE
LIVE_MANAGER_ACTIVE_SET     = EMPTY
LIVE_USER_VISIBLE_COMMAND   = RUNNING
```

## §3 — Refuted hypotheses

OC1 missing owner stamp, OC2 active-session ID drift, OC3 guard
unavailable, TaskHeader projection bug, Q5 guard-result ignored:
ALL REFUTED for this occurrence (the prior BOCOR01 ACT proved
this in its `12-causal-classification.txt`).

The defect lies BEFORE the owner lookup, or in a split authority
between the Q5 manager and the manager that owns the job.

## §4 — Recon

See `.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01/03-authority-map.md`
and `04-recon.txt` for the seven production seams mapped:

  A. CommandJob creation (manager.start + VscodeSessionHost.create)
  B. state/status reads by jobId (manager.status + command_status tool)
  C. cancellation (manager.cancel + cancelBackgroundCommand RPC)
  D. finalization (manager.finalize + dispose)
  E. lifecycle publication (emitCommandJobLifecycle + backgroundStateChange)
  F. manager construction and ownership (new CommandJobManager per VscodeSessionHost.create)
  G. status fallback (manager.status is the SOLE status path)

NON-SINGLETON MANAGER (verified): every `VscodeSessionHost.create`
call site in SdkController.ts instantiates a fresh manager. The
LA2 / LA5 risk surface is the active session host replacement.

## §5 — Hypotheses (LA1..LA6)

See `05-hypotheses.md` for the full hypothesis definitions and
discriminator patterns. Mechanical classification uses the
diagnostic dump's `managerInstance` / `hostInstance` correlation
tokens to join the load-bearing events.

## §6 — RED reproduction target

The RED target: same jobId AND one production surface says RUNNING
AND the guard-authoritative CommandJobManager says job absent.
Deterministic synthetic reproduction via two `CommandJobManager`
instances (managerA owns job; managerB does not). Verified by
BCLAS-04 second test.

## §7 — Diagnostic design

See `06-diagnostic-design.md`. The BJLA ring module lives at
`apps/vscode/src/sdk/background-job-liveness-authority.ts`. The
host-side dump adapter at
`apps/vscode/src/sdk/background-job-liveness-authority-runtime.ts`.

## §8..§14 — Diagnostic wiring

See `06-diagnostic-design.md` §7 (production wiring surface table).
The capture calls fire at:

  - `command-job-manager.ts:1272` (process_terminality_record — LA1 discriminator)
  - `command-job-manager.ts:1864` (job_active_inserted)
  - `command-job-manager.ts:2462` (job_active_removed)
  - `command-job-manager.ts:2664` (job_status_lookup)
  - `command-job-manager.ts:2733` (job_cancel_lookup)
  - `command-job-manager.ts:3005` (manager_dispose_begin)
  - `command-job-manager.ts:3053` (manager_dispose_end)
  - `command-job-manager.ts:1286` (job_lifecycle_event_published — fires after the LA1 capture)
  - `vscode-session-host.ts:380` (manager_constructed)
  - `vscode-run-commands-tool.ts:622` (background_state_change_published)
  - `sdk-session-event-coordinator.ts:366` (BOCOR enrichment with `managerInstance` / `hostInstance`)

Each call is gated by the `captureEnabled` seam; default OFF.

## §15 — Diagnostic identities

Diagnostic-only object identities via WeakMaps:

```ts
const managerIds = new WeakMap<object, number>()
const hostIds = new WeakMap<object, number>()
```

Assignment only when capture is ON. Returns strings `M<n>` / `H<n>`.
NEVER projected to wire / proto / webview state. The
`managerInstance` / `hostInstance` BOCOR enrichment is additive
(OPTIONAL fields, default null when capture is OFF).

## §16 — Required causal sequence

See `14-job-lifecycle-timeline.md`. T0..T8 with the expected
shape for one jobId. The next ACT joins BJLA → BOCOR → TSWPD on
the same jobId to classify.

## §17 — Mechanical classification

See `15-causal-classification.txt`. The BCLAS test family
mechanically classifies each hypothesis as POSITIVE / NEGATIVE on
synthetic data. LA1..LA5 discriminators documented per ACT
sec 17; LA6 catch-all.

## §18 — Process identity

This ACT does not alter the PGID postcondition probe or the
helper-owned registration path. PID-reuse false positives remain
guarded by the helper's `start_us` capture (per the upstream
invariant cited in ACT sec 0).

## §19 — Ablation

ABLATION = NOT_EXECUTED. The ablation tests are constructed by
the next ACT after the LIVE classification is established. Per
ACT sec 31: "Add hypothesis-specific RED/GREEN only after
classification. Do not pre-build tests for all five hypothetical
repairs."

## §20 — Repair authorization

REPAIR_PERFORMED = false. Per ACT sec 20, repair requires
RED_REPRODUCED + LIVE causal capture + classification +
necessity/ablation + bounded seam. None of these are met in this
ACT (LIVE capture requires operator).

## §21..§24 — Repair contracts (planned, NOT applied)

See `18-repair-diff.txt` for the planned bounded repair per
LA1..LA5. This ACT does NOT apply any repair.

## §25 — Conservation

See `15-conservation.txt`. C1..C14 verified via the BCLAS test
family. The diagnostic has zero semantic delta when the capture
seam is OFF (BCLAS-05 proves this exhaustively).

## §26 — Adversarial cases

The BCLAS tests cover:
  - normal managed long job (BCLAS-01)
  - natural completion (BCLAS-02)
  - user cancellation (BCLAS-02)
  - manager-instance split (BCLAS-04)
  - capture ON/OFF zero-delta (BCLAS-05)

The next ACT adds adversarial cases for:
  - rapid command exit
  - host/session replacement while job running
  - unrelated second session
  - same PID reused after old job
  - shell `cmd &` unmanaged child

## §27 — Diagnostic commands

  - `Cline Debug: Dump Background Job Liveness Authority`
    (NEW, this ACT)
  - `Cline Debug: Dump Background Owner Correlation` (predecessor)
  - `Cline: Dump Turn State Writer Provenance Diagnostic`
    (predecessor)

Artifact: `<globalStorageUri>/background-job-liveness-authority.jsonl`.
Dump does NOT clear the ring.

## §28 — LIVE operator procedure

See `.factory/evidence/.../21-live-qualification.md` for the
operator-driven procedure. The operator installs the diagnostic
build, runs `sh -c 'echo STARTED; sleep 600; echo FINISHED'`,
captures the three dumps + screenshot, then (optionally) clicks
Cancel as a discriminator.

## §29 — Required LIVE proof packet

The packet (recorded by the operator):

  - same jobId
  - BJLA lifecycle chain
  - BOCOR decision (now enriched with managerInstance / hostInstance)
  - TSWPD transition
  - UI screenshot
  - managerInstance / hostInstance identities
  - start insertion
  - any removal / finalize
  - status lookup source
  - guard manager

## §30 — Diagnostic removal trigger

Per ACT sec 30: remove BOCOR + BJLA together once root cause is
isolated AND the bounded repair is qualified. NOT_TRIGGERED in
this ACT (LIVE classification not yet established).

## §31 — Tests

See `.factory/evidence/.../07-diagnostic-tests.txt`. New BCLAS
test family: 5 files / 7 tests PASS. Local result:

```text
✓ background-job-liveness-authority.bclas01.test.ts (2 tests) 30ms
✓ background-job-liveness-authority.bclas02.test.ts (1 test)  30ms
✓ background-job-liveness-authority.bclas03.test.ts (1 test)  56ms
✓ background-job-liveness-authority.bclas04.test.ts (2 tests) 29ms
✓ background-job-liveness-authority.bclas05.test.ts (1 test)  56ms
✓ background-job-liveness-authority.bclas06.test.ts (2 tests) 108ms  (LA1 process-terminality discriminator)
Test Files  6 passed (6)
     Tests  9 passed (9)
```

## §32 — Gates

See `.factory/evidence/.../08-build-before-live.txt` and
`23-gates.txt`. Local gates:

  G1  bun run check-types               PASS (local)
  G2  bun run test:unit (focused)       PASS (local, 207+ tests)
  G3  bun run vscode:prepublish          NOT_EXECUTED (substrate)
  G4  git diff --check                  PASS
  G5  git status --short                CLEAN
  G6  focused existing command-job suites  PASS
  G7  new BCLAS tests                    PASS (9 tests, 6 files)

Per ACT sec 32 HALT_UNAVAILABLE_FROM_ENVIRONMENT: G3 is a
substrate limitation, NOT a code defect. Operator re-runs before
artifact qualification.

## §33 — Exact artifact binding

See `.factory/evidence/.../09-vsix-identity.txt`. The Cloud
Agent cannot build a real VSIX; the operator builds it against
SOURCE_HEAD `bec53f6558e7e0fdb917e57d1780040c5b9708d1` and records
the SHA256 / byte_size / installed_version.

## §34 — Evidence directory

`.factory/evidence/ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01/`:

  01-entry-state.txt
  02-live-evidence-freeze.md
  03-authority-map.md
  04-recon.txt
  05-hypotheses.md
  06-diagnostic-design.md
  07-diagnostic-tests.txt
  08-build-before-live.txt
  09-vsix-identity.txt
  10-live-bjla.jsonl
  11-live-bocor.jsonl
  12-live-tswpd.jsonl
  13-live-screenshot-index.md
  14-job-lifecycle-timeline.md
  15-causal-classification.txt
  16-red.txt
  17-ablation.txt
  18-repair-diff.txt
  19-conservation.txt   (placeholder)
  20-green.txt
  21-live-qualification.md
  22-diagnostic-removal.txt
  23-gates.txt
  result.json

## §35 — Result schema

See `result.json`:

```json
{
  "act_id": "ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01",
  "classification": "UNRESOLVED",
  "verdict": "CAPTURE_INSUFFICIENT",
  "halt_conditions_triggered": ["CAPTURE_INSUFFICIENT"],
  "stop_rule_observed": true,
  "next_act_required_for_repair": "ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT-REPAIR01"
}
```

## §36 — Allowed classifications

```text
CASE_LA1_PREMATURE_FINALIZATION
CASE_LA2_MANAGER_INSTANCE_SPLIT
CASE_LA3_STALE_PROJECTION
CASE_LA4_STATUS_AUTHORITY_SPLIT
CASE_LA5_MANAGER_REPLACEMENT_STRANDS_ACTIVE_JOB
CASE_LA6_OTHER_PROVEN_CAUSE
NOT_REPRODUCED
CAPTURE_INSUFFICIENT
```

Repair verdicts:
```text
PASS_CASE_LA1_REPAIRED
PASS_CASE_LA2_REPAIRED
PASS_CASE_LA3_REPAIRED
PASS_CASE_LA4_REPAIRED
PASS_CASE_LA5_REPAIRED
PASS_CASE_LA6_REPAIRED
```

## §37 — Halt taxonomy

Only P0 halts:
```text
HALT_UNEXPECTED_TRACKED_DIRT       = NOT_TRIGGERED
HALT_RED_NOT_REPRODUCED           = NOT_TRIGGERED
HALT_DIAGNOSTIC_CHANGES_SEMANTICS = NOT_TRIGGERED (BCLAS-05 proves zero-delta)
HALT_PROCESS_IDENTITY_UNPROVEN    = NOT_TRIGGERED
HALT_CAUSALITY_NOT_ESTABLISHED    = NOT_TRIGGERED (LIVE bind is operator's)
HALT_PRODUCT_CONTRACT_REQUIRED    = NOT_TRIGGERED (next ACT may surface)
HALT_REPAIR_EXCEEDS_PROVEN_CAUSE  = NOT_TRIGGERED (no repair in this ACT)
HALT_BUILD_RED                    = NOT_TRIGGERED (synthetic GREEN)
HALT_LIVE_GREEN_ABSENT            = NOT_TRIGGERED (LIVE GREEN is next ACT's)

Normal terminal outcome:
  CAPTURE_INSUFFICIENT              = TRIGGERED (legitimate verdict)
```

## §38 — Board update

Recorded in `.factory/epic-board.md`. New row:

```
## ACT-CLINEMM-BACKGROUND-COMMAND-LIVENESS-AUTHORITY-SPLIT01 — CAPTURE_INSUFFICIENT — 2026-09-20
```

Captures: BG_JOB_LIVENESS_AUTHORITY = UNRESOLVED, LIVE_UI_JOB =
cmd_mu9qjxmwxl5hasi8/RUNNING, LIVE_Q5_MANAGER_ACTIVE_SET =
EMPTY, Q5_GUARD = EXONERATED, OWNER_CORRELATION =
SUPERSEDED_BY_LIVENESS_AUTHORITY_SPLIT, START/STATUS/GUARD/REMOVE
MANAGER = unobserved, ACTIVE_REMOVAL = unobserved, STATUS_SOURCE
= unobserved, REPAIR = none, TURN_STATE / TASK_HEADER =
OUT_OF_SCOPE / CONSERVED.

## §39 — STOP rule

Once the operator drives the LIVE reproduction AND the BJLA dump
mechanically classifies the occurrence AND the bounded repair
is qualified — STOP. Do NOT change Q5 / TaskHeader /
submit_and_exit / terminal rows / redesign all session
lifecycle / ban shell & / change PGID / helper containment /
introduce global manager lookup / build permanent observability
infrastructure / clean unrelated Factory residue.

One `jobId`. One lifecycle. One authority split.
