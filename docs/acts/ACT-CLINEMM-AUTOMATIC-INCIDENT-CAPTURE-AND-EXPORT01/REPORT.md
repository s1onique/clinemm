# ACT-CLINEMM-AUTOMATIC-INCIDENT-CAPTURE-AND-EXPORT01 — Report

**Short name:** AICE01
**ENTRY_HEAD:** `c69d22a287adb40f13a901e6e0eee21daaefabaf`
**ENTRY_TREE:** `7d1c52ca216cc5212c670d3af5c1c30c3770ffa0`

---

## 1. Problem

When a Cline task is held at the C10 completion barrier — an unresolved
containment obligation, an unconsumed terminal, a stalled background job —
the evidence of WHY it was held existed only as a flat, bounded checkpoint
and only in the extension host's process memory. There was:

- no incident-scoped artifact or identity at the hold;
- no reconciliation registration / attempt / exhaustion evidence;
- nothing addressable to restore after a restart;
- no user-facing report command or export path.

A user who hit this could not produce a support report, and a reviewer
could not reconstruct the causal chain. Worse, a PUBLIC build captured
**nothing at all**, because the capture was armed only by the central
dogfood profile.

## 2. Repair

An automatic, incident-scoped capture that opens an incident **at the
authoritative boundary**, makes it durable **at that same boundary**,
survives a restart, and can be exported as a single privacy-safe local ZIP
with one click.

### 2.1 Production changes

**`src/sdk/automatic-incident-capture.ts`** (new) — the incident manager.

- An incident is keyed by its CAUSAL IDENTITY (session, task, epoch,
  barrier, coordinator instance, extension-host instance), not by a task id
  alone. A task switch therefore never loses the incident being left.
- The manager retains the per-job COVERAGE of the causal chain. Every
  coverage field is an EXPLICIT observation state (`OBSERVED`,
  `NOT_OBSERVED`, `EVIDENCE_LOST`, `NOT_APPLICABLE`); a field is never
  inferred from silence.
- Observations are coalesced by a dedup key that is STORED at record time
  (not recomputed later), so a later change to the blocking set cannot
  shift the key of an already-recorded decision.
- The retention bound is enforced in memory; the oldest is evicted first.

**`src/sdk/automatic-incident-persistence.ts`** (new) — durable storage.

- Incident-scoped directories under
  `<globalStorageUri>/completion-incidents/<incidentId>/` with the file
  set `incident.json`, `evidence.json`, `coverage.json`,
  `build-identity.json`, plus a durable `index.json`.
- ATOMIC writes (write to a temp file, then `rename`).
- A PER-INCIDENT write chain, so concurrent writes to one incident cannot
  interleave.
- A MONOTONIC REVISION GUARD: the persisted revision is read BEFORE the
  write and an OLDER snapshot is refused. (This guard was added because
  the acceptance suite caught a real defect — see §4.)
- The persistence layer NEVER throws into the production path.

**`src/sdk/automatic-incident-export.ts`** (new) — the privacy-safe ZIP.

- A STRICT KEY ALLOWLIST. Unknown keys are DROPPED, not redacted, so a
  future boundary that adds an unexpected payload cannot leak it.
- Bounded strings and arrays.
- Flat, relative, normalized archive member names only.
- A per-member sha256 manifest with an EXPLICIT integrity contract (the
  manifest cannot carry its own hash; its digest is published out of band
  and the contract is declared in `manifestIntegrity`).
- Built with `archiver`, an ALREADY-DECLARED and ALREADY-INSTALLED
  dependency. **No new dependency was added.**

**`src/sdk/automatic-incident-export-runtime.ts`** (new) — the flow.

- Resolves the ACTIVE task's incident through the HOST's authority.
- Shows a concise privacy-safe preview, asks for confirmation, opens the
  native Save dialog, writes the ZIP.
- The dialogs are HOST-ABSTRACTED, so the same flow backs both the
  Command Palette command and the webview request.

**`src/sdk/automatic-incident-build-identity.ts`** (new) — the exact
build/runtime identity, with honest `VERIFIED` / `MISMATCH` / `UNOBSERVED`
states.

**`src/sdk/automatic-incident-consent.ts`** (new) — the user's consent and
retention controls.

**`src/sdk/reconciliation-diagnostic-capture.ts`** (new) — the
reconciliation lifecycle evidence: registration, attempts, resolved,
exhausted, cancelled.

**`src/core/controller/ui/reportTaskProblem.ts`** (new) — the narrow
webview -> extension-host route. The request carries NO incident id, NO
task id and NO filesystem path.

**`src/extension.ts`, `src/registry.ts`, `apps/vscode/package.json`** — the
command contributions and the activation.

**`webview-ui/.../ReportTaskProblemButton.tsx`** (new) — the task-header
button.

**`proto/cline/ui.proto`** — the single new RPC:
`UiService.reportTaskProblem(EmptyRequest) returns (Empty);`

### 2.2 The public-build semantics

The ACT requires the public build to "automatically preserve a minimal
local incident summary". The capture is therefore ALWAYS ARMED, and the
DEPTH is what varies:

| Build / consent | Depth | Retained |
|---|---|---|
| Public, no opt-in | `minimal` | causal identity, stage/outcome verdicts, blocking-set identity, counters, per-job coverage verdicts, a MINIMAL detail allowlist |
| Dogfood OR explicit opt-in | `detailed` | additionally the per-key detail map and the reconciliation timeline |

The detailed depth is opt-in and DEFAULTS TO FALSE. The opt-in persists in
the file-backed global state under `clineDetailedLocalDiagnosticsEnabled`.

## 3. What this ACT did NOT change

Completion semantics, containment semantics, the C10 barrier semantics, the
Elm production kernel semantics, the TCRR01 reconciliation's state
semantics, the CIFR per-capsule bounds, the BJLA liveness-authority
semantics, and the existing developer dump commands' output contracts are
all unchanged. The capture reads the facts the production decision already
computed; it never re-probes a process and never signals.

## 4. Two real defects the acceptance suites caught

These were not theoretical. Both were found by the GREEN acceptance
assertions and fixed:

1. **A stale snapshot could overwrite newer evidence on disk.** The
   per-incident write chain serializes the writes that go through one
   process, but a caller can still hand the layer an OLDER snapshot after a
   newer one was written. The persistence layer had no on-disk guard. The
   fix is the MONOTONIC REVISION GUARD (`readPersistedRevision` + a
   refusal). Proven by
   `"A5 — an older snapshot finishing late NEVER overwrites a newer one"`.

2. **The exporter was not allowlisted.** `sanitizeDetail` retained every
   primitive value of the detail map, subject only to a length cap, so an
   unexpected payload WOULD have leaked into a user-shared report. The
   privacy suite caught the leak concretely (an absolute path sentinel
   reached `completion-timeline.jsonl`) and the strict key allowlist was
   added.

## 5. Verification

- **123 focused tests pass across 12 suites** (4 new AICE01 acceptance
  suites plus the TCRR01, BJLA, CLCR01, CFC10AR01, CIFR bundle and CIFR
  loss suites).
- The **full typecheck** (base + VS Code compat + webview) passes.
- The **lint** passes with 0 errors.
- The **production bundle** builds.
- The **full node-side unit suite** reports 1403 pass / 5 fail; all five
  failures are **proven pre-existing** at the clean ENTRY_HEAD baseline
  (see `evidence/verification.txt` §5 for the proof).

Full detail: `evidence/verification.txt`, `evidence/ablation-results.txt`,
`evidence/adversarial-results.txt`, `evidence/production-seam-map.md`,
`evidence/red-reproduction.txt`, `evidence/artifact-identity.json`.

## 6. Known limitations

1. **No installed-VSCodium LIVE qualification was performed.** The
   user-facing path is covered by unit/integration acceptance suites and by
   the production bundle build, but the one-click flow was not exercised in
   a live installed extension host. The `src/dev/debug-harness/` harness
   is the intended vehicle for that qualification.
2. **The reconciliation-to-incident correlation depends on the job/session
   matching.** A reconciliation record for a job that is NOT in the
   incident's blocking set, or whose owner session differs, is deliberately
   NOT joined. Such a record is therefore not visible in the incident's
   timeline — this is the honest behaviour (it prevents cross-task
   contamination), but it means the incident's reconciliation timeline can
   be empty for a reconciliation that preceded the hold.
3. **The public `minimal` depth does not retain the reconciliation
   timeline.** The per-job coverage verdicts carry the same reconciliation
   outcome, but the per-attempt forensic detail requires the `detailed`
   depth (dogfood or the explicit opt-in).
4. **`package.json` was NOT re-packed into a VSIX** as part of this ACT.
