# ACT-CLINEMM-CONTAINMENT-FAILURE-PROVENANCE-RETENTION01 — LIVE qualification instructions

**Status: NOT PERFORMED.** This ACT delivers the structural capability only. No VSIX was
built and nothing was installed, so **no LIVE verdict is claimed**. The target verdict
`PASS_STRUCTURAL_READY_FOR_LIVE` means *the capability is ready to be qualified*, not
*that it has been qualified*.

## 0. Preconditions

1. The source commit that produced the protected store must be committed on `main`.
2. The dogfood VSIX must be built from that EXACT commit using the existing validated
   workflow (`bun run package` from `apps/vscode`, with `mkdir -p "$ROOT/dist"` first —
   `vsce package --out` fails with a confusing `ENOENT` when the output directory does
   not exist).
3. The VSIX must be installed into the dogfood VSCodium profile and the installed
   extension version must be **observed**, not assumed.

Record the artifact identity exactly:

```text
DOGFOOD_SOURCE_HEAD:      <the exact commit sha>
extension_version:        <the version string in the built package.json>
vsix_path:                <absolute path of the .vsix>
vsix_size_bytes:          <integer>
vsix_sha256:              <hex digest>
installed_extension_version: <the version reported by the INSTALLED extension>
```

**Do not represent a successfully built VSIX as installed unless installation was
observed.**

## 1. What must happen during the LIVE run

The LIVE acceptance criterion is deliberately narrow:

> At least ONE actual C10 blocker whose original failure evidence would have aged
> beyond the ordinary 256-record FIFO must still be present in the protected retention.

A short live run that never exercises FIFO eviction is **partial qualification only**.

The protected store bounds make this concrete:

| Bound | Value | Consequence |
|---|---|---|
| Ordinary BJLA FIFO | 256 records (UNCHANGED) | the original failure record is evicted after 256 ordinary events |
| Protected jobs | 128 | up to 128 distinct failed jobs keep their original verdict |
| Protected blocking sets | 4 | the last four nonempty C10 blocking sets are retained |
| Blocking-set job ids per snapshot | 64 | a larger set is TRUNCATED with the exact omitted ids reported |

With 128 protected jobs, the ordinary FIFO needs only ~128 unrelated lifecycle events
after the failure to evict its cause — a busy session reaches that quickly.

## 2. The LIVE procedure

1. Run ordinary ClineMM dogfood work until a containment-related `Paused` occurrence
   appears.
2. **Immediately** invoke the Command Palette command
   `cline.debug.dumpBackgroundJobLivenessAuthority`.
   - It writes `background-job-liveness-authority.jsonl` (the ORIGINAL artifact, format
     unchanged) **and** the companion
     `background-job-liveness-authority.provenance.json`.
   - The dump does **NOT** clear the protected store: repeated dumps are safe and
     byte-identical when no new events occur.
3. Also invoke the existing `cline.debug.dumpCompletionIncidentBundle`.
4. Join the C10 `blockingJobIds` (from the completion-incident bundle / the retained
   blocking-set snapshots) against the protected provenance.
5. For EACH blocking job, read from
   `provenance.protectedJobs[].failureRecord`:
   - `postcondition` — `gone` | `alive` | `eperm` | `unknown` | `null`
   - `osErrorCode` — the verbatim errno (`EPERM`, `ESRCH`, `null`, …)
   - `containmentFailed` — `pgid_unset` | `substrate_alive` | `substrate_eperm` |
     `substrate_unknown`
   - `ownerSessionId`, `pid`, `pgid`, `managerInstance`, `capturedAt`
6. For EACH blocking job, read `provenance.coverage[]`:
   - `failureRecordAvailability` — `JOIN_COMPLETE` | `JOIN_INCOMPLETE` |
     `UNAVAILABLE_FROM_TRACE`
   - `terminalPublicationAvailability` — same enum
   - `blockingSetMembershipAvailability` — same enum
   - `ownershipClass` — `matching_owner` | `foreign_owner` | `unknown_owner` |
     `owner_map_absent`
7. Identify missing evidence explicitly. Read `provenance.loss`:
   - `protectedJobEvictions`, `protectedRecordEvictions`,
     `blockingSetEvictions`, `blockingSetTruncations`.
8. Evaluate whether enough evidence exists to select a repair hypothesis.

**Do not issue new signals or terminate any process solely for this diagnostic.**


## 3. Reading the result honestly

| Observation | Classification |
|---|---|
| The blocking job is joined to retained original provenance AFTER FIFO eviction (the ordinary JSONL no longer contains `containment_failure_classified` for that job, but the companion artifact does) | `PASS_LIVE_JOIN` |
| The required join cannot be completed, and the exact missing evidence is documented | `CAPTURE_INSUFFICIENT` |
| A required later process fact cannot be observed safely | `LIVE_UNOBSERVABLE` |
| The diagnostic changes alter execution or containment semantics | `HALT_PRODUCTION_DELTA` |

**Even `PASS_LIVE_JOIN` does not prove the process group is currently alive or gone.**
The retained record is the ORIGINAL observation, captured at classification time. It
says what the kernel verdict WAS. It says nothing about what the group is doing now.
A later authoritative observation would require a NEW process signal, which this ACT
forbids.

A missing record is **never** evidence of a successful cleanup.

## 4. Interpreting `coverage[].failureRecordAvailability`

| Value | Meaning |
|---|---|
| `JOIN_COMPLETE` | the original failure record IS retained and joined by exact job id |
| `JOIN_INCOMPLETE` | the recorder can PROVE the record exists but the join could not be completed (e.g. the blocking set was truncated and omitted the job id) |
| `UNAVAILABLE_FROM_TRACE` | the record is not retained and the recorder cannot prove why (never captured, or evicted and not individually attributable) |

When the recorder CAN prove a specific eviction, it is counted in `provenance.loss`.
When it cannot, the record is reported as `UNAVAILABLE_FROM_TRACE` — no eviction cause
is invented.

## 5. The four LIVE blockers from the 2026-11-04 capture

These identities are REAL. Their original cleanup postconditions and OS errors are
**UNAVAILABLE_FROM_TRACE** in that capture and MUST NOT be reconstructed:

```text
cmd_mw2gknnryrnqwcmw
cmd_mw2h9j8n9ncptte7
cmd_mw2hb1nm5rp9fr8j
cmd_mw2hcxbjse0zbl22
```

Do **not** infer `substrate_alive`, `substrate_eperm`, or a later successful cleanup for
those four jobs. The protected recorder is what makes a FUTURE occurrence recoverable;
it cannot retroactively recover what the 2026-11-04 capture did not observe.
