# C9 — Terminal verdict

**ACT:** `ACT-CLINEMM-MCP-EXECUTION-CONTROL-V1-01`
**Branch:** `main`
**Entry HEAD:** `ae802ca980ae116a3d4c5d35411f4e6628681ac2`
**Entry tree:** `452d2a27643d985a9ac2a75b74496b701f6c76ba`
**Version:** `4.1.26`
**Predecessors consumed:** `ACT-CLINEMM-EMBEDDED-MCP-CONTROL-SEAM-RECON01`
(read-only seam), `ACT-CLINEMM-MCP-TASK-STATE-PROJECTION01` (published
task-state) — consumed, not re-done.

---

## C9.1 Verdict

# `PASS_STRUCTURAL_ONLY`

> **The charter's success criterion is:** *"Allow Codex Desktop to start
> and observe one ClineMM task through the existing installed VS Code
> extension, without creating a second runtime, bypassing approval, or
> duplicating execution."*
>
> **What is proven:** the implementation is complete and the executable
> gates pass. The start routes through the **EXISTING**
> `SdkController.initTask()` → `SdkTaskStartCoordinator.initTask()` →
> `SdkSessionLifecycle.startNewSession()` chain and returns the
> **REAL** accepted session id. The events are read from the
> **EXISTING** `SdkMessageCoordinator.onSessionEvent()` publication
> boundary with their real `seq` / `epoch` identity. The security
> boundary — a separate, instance-bound, workspace-bound,
> constant-time-compared write credential, default OFF, invalidated on
> host replacement — is enforced **by the extension-host server on
> every request**, not by an MCP annotation.
>
> **What is NOT proven:** the **live** pilot against a running installed
> extension. No ClineMM extension is installed on this host, and the
> contract forbids the code-execution environment from installing one.
> The operator's exact build / install / opt-in steps are in
> `09-live-qualification.md`.
>
> Hence `PASS_STRUCTURAL_ONLY` rather than `PASS_MUTATION_LIVE`: the
> charter itself defines `PASS_STRUCTURAL_ONLY` as "implementation and
> executable gates pass; installed qualification pending", and
> `PASS_MUTATION_LIVE` requires "Codex started and observed one real
> task through the installed extension".

---

## C9.2 The charter's questions, answered

### Can Codex Desktop delegate one task to the existing ClineMM extension without acquiring a second execution authority? — **Yes, structurally.**

`clinemm_start_act` calls the **same** `initTask()` the webview's
"New Task" button reaches. That allocates the session id through the
EXISTING `SdkTaskStartCoordinator` and `SdkSessionLifecycle`, and
returns the REAL accepted identity. The seam holds no `ClineCore`, no
`LocalRuntimeHost`, no `SessionRuntime`, no execution loop, no
scheduler. The **native editor and approval authority are untouched** —
the seam exposes no approval-responding operation at all.

### Is the mutation authority safely bounded? — **Yes.**

| Property | Evidence |
|---|---|
| Default OFF | `R1-3`, `R6-9` |
| Separately enabled by the operator | `R6-9` |
| Distinct random write credential, never the read token | `R1-4` |
| Constant-time comparison, per request, on an open connection | `authorizeControlSeamMutation()` |
| Instance-bound, invalidated on host replacement | `R6-5` |
| Workspace-bound; the client can only ASSERT, never SELECT | `R6-1`, `R6-1b` |
| `0600` file inside the `0700` directory; removed on dispose | `R6-8` |
| No secret in any log or MCP response | source inspection |
| The read-only client view is UNCHANGED | `R6-6`, `PX01` |

### Is the observation trustworthy? — **Yes.**

The event buffer is a **reader** of the EXISTING publication boundary,
not a new bus and not a reconstructed timeline. It reuses the existing
`seq` / `epoch` ordering identity. Missing events are REPORTED as
`cursorExpired`, never synthesized. `clinemm_get_run` remains
authoritative for the latest published phase.

### Does it duplicate execution? — **No.**

The bounded, instance-local ledger binds the client-supplied
`requestId` to its payload and its outcome: same key + same payload →
the same recorded outcome; same key + different payload → rejected; a
duplicate delivered during an in-flight start → joins that operation.
The ledger is **explicitly in-memory**; after a host restart it is
empty and this ACT does not pretend otherwise.

---

## C9.3 Why not the other verdicts

| Verdict | Why not |
|---|---|
| `PASS_MUTATION_LIVE` | Requires that Codex started and observed one real task **through the installed extension**. No ClineMM extension is installed on this host, and the contract forbids the code-execution environment from installing one. The live pilot is **pending operator action**, with exact steps recorded. |
| `HALT_RED_NOT_REPRODUCED` | The essential production behaviour WAS reproduced and exercised: the start boundary, the authoritative acknowledgement, the ownership fence, and the event publication boundary are all EXISTING production surfaces, and all 31 focused R1–R6 tests plus 8 proxy tests execute against them. |
| `HALT_<reason>` | **No new P0 was demonstrated.** No security boundary was broken; no pre-existing semantic was disturbed. The C9/C10, BCB, Elm task-header, CPR01, and session-lifecycle gates are unchanged. |
| `CAPTURE_INSUFFICIENT` | The evidence is sufficient: the actual start acknowledgement (`initTask()`'s returned session id) and the event correlation (the existing `seq` / `epoch` identity) were both established against the production seams. |

---

## C9.4 Risk register

| Severity | Count | Items |
|---|---|---|
| **P0** | **0** | — |
| **P1** | **0** | — |
| **P2** | **3** | See below |

### P2 items

| # | Item | Disposition |
|---|---|---|
| R-A | **The live pilot is pending.** The vertical slice is structurally proven but has not yet been exercised against a running installed extension. | **Accepted and explicit.** Exact build / install / opt-in steps are in `09-live-qualification.md`. The charter's `PASS_STRUCTURAL_ONLY` covers exactly this state. A successor ACT should run the pilot and close it as `PASS_MUTATION_LIVE`. |
| R-B | **The idempotency ledger is in-memory.** After an extension-host restart, a replayed `requestId` is treated as a fresh key. | **Accepted and explicitly bounded.** The contract says: "After host restart, do not pretend an in-memory ledger guarantees durable exactly-once delivery." The ambiguity is reconciled through the EXISTING session state (`clinemm_get_run`) before retrying, and there is **no automatic retry**. |
| R-C | **The event ring is bounded (500 events) and lost on disposal.** A client that falls behind sees `cursorExpired` and must reconcile through `clinemm_get_run`. | **Accepted.** This is the contract's explicit requirement ("bounded response and bounded retention", "report cursor expiry or gaps explicitly"). It is not a defect; it is the designed bound. |

### Explicitly NOT implemented (C8 scope exclusions)

`clinemm_send_feedback`, `clinemm_cancel_run`,
`clinemm_respond_approval`, arbitrary task switching, Hub/CLI session
attachment, automatic approval, workspace selection outside the
installed VS Code workspace, an MCP protocol infrastructure
replacement, and a second task scheduler / agent runtime. **None of
these exist** in the shipped surface (`R6-10` proves it).

---

## C9.5 Explicit non-claims

- **No live observation is claimed.** Every behavioural statement rests
  on an executed test against a real production server class, or on
  source-level analysis.
- **The passing tests do not prove the seam is *safe*.** They prove the
  specific properties enumerated in `08-r1-r6-mapping.md`.
- **Nothing was pushed, released, packaged, or installed.** No VSIX was
  produced or replaced; no extension was installed; no real user task
  was created, cancelled, resumed, switched, or replaced.
- **No durable exactly-once claim is made.** See R-B.
- **The idempotency ledger does not promise cross-restart dedup.**

---

## C9.6 Evidence index

| File | Content |
|---|---|
| `00-identity.md` | C0 — identity, protected state, toolchain, the consumed production-seam reconnaissance |
| `01-focused-control-seam-tests.txt` | The focused control-seam suite transcript (124 passed / 2 pre-existing failures) |
| `02-preexisting-failure-baseline.txt` | The stash-based BASE-commit reproduction of the 2 COR02 + 5 C10-filter failures |
| `03-lifecycle-fence-cpr01-elm-gates.txt` | Session start + lifecycle fences, `SdkController`, CPR01, Elm task-header authority |
| `04-bcb-c9-c10-gates.txt` | BCB barrier + C9/C10 commit-driven publication + statechart causal repair |
| `05-typecheck-lint-build.txt` | Typecheck (`tsc_exit=0`), scoped lint (0 errors), format (clean), extension bundle build |
| `06-artifact-identity.txt` | C7 — exact source HEAD / tree / version / bundle path / byte size / SHA-256 |
| `07-security-and-conservation.md` | C1 / C2 / C3 / C4 — the security, opt-in, start, event-read, and protocol contracts as implemented |
| `08-r1-r6-mapping.md` | C5 — the RED → GREEN mapping for every R1–R6 requirement, and the C6 gate table |
| `09-live-qualification.md` | C7 — exact operator build / install / opt-in steps and the live pilot procedure |
| `10-verdict.md` | C9 — this file |
| `SHA256SUMS.txt` | The evidence package's own hashes |
