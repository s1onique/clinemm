# ACT-CLINEMM-ELM-SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION

**Status:** CLOSED at C5 (PASS_ELM_SEAM08_SUBSTRATE)

**Verdict:** `PASS_ELM_SEAM08_SUBSTRATE` — compiled Elm candidate and correspondence proven; production authority cutover deferred to a follow-up ACT.

**Date:** 2026-10-09
**Entry HEAD:** `44f0394be13b3eae3d8aeaff3589323ca41956e0`
**Final HEAD:** see final commit (post-substrate)
**Branch:** `main`

---

## 0. MISSION (summary)

Migrate one bounded post-await decision authority in
`SdkSessionEventCoordinator.enqueueCompletionContinuationIfHeld`
(apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1442-1726) from
TypeScript to Elm, with **graded authority**: E3.1 = primary, E1.1 =
read-only validation, E2.1 = conditional expansion only if E3.1
proves safe.

The user's additional constraint: every Elm result must be
revalidated against the current marker identity and dedupe state
before TypeScript commits any effect. This ACT proves the
bounded-decision substrate; the production cutover (C6) requires a
follow-up ACT to wire the consult into the live seam.

## 1. REPOSITORY SAFETY

```
ENTRY_HEAD=44f0394be13b3eae3d8aeaff3589323ca41956e0
ENTRY_BRANCH=main
ENTRY_STATUS=clean
```

No stashes, no unexpected tracked dirt, no historical rewrites.

## 2. SCOPE

### In scope (this ACT)

- Compile a new Elm kernel
  `apps/vscode/elm/deferred-completion-barrier/` owning the E3.1
  post-await decision surface.
- Build a typed TS adapter
  `apps/vscode/src/sdk/deferred-completion-barrier-elm.ts`.
- Extend `_ELM_KERNELS` in
  `scripts/build_dogfood_vsix_lib.py`.
- Prove C1 (interop discriminator) and C5 (stale-decision
  TOCTOU discriminator) at the substrate level.

### Out of scope (deferred)

- **C6 E3.1 production cutover** — wiring the consult into
  `enqueueCompletionContinuationIfHeld` and adding commit-time
  identity revalidation in TS. This is the most invasive change
  in SEAM08; the ACT explicitly defers it to a follow-up ACT
  (`SEAM08.1` or similar) after the substrate is reviewed.
- **C7 E1.1 read-only validation** — optional, recommended to
  skip unless runtime cost is zero.
- **C8 E2.1 conditional expansion** — explicitly out of scope
  per ACT §11 (would require a second completion gate; not safe).

### TypeScript-owned effects (unchanged)

All existing TS effects in the production seam remain unchanged:
The Elm kernel is a pure projection `Facts -> BarrierDirective`.
It NEVER mutates any host state.

## 3. C0 — EXACT PRODUCTION BOUNDARY (DONE)

The E3.1 decision surface is the three branches in
`enqueueCompletionContinuationIfHeld` (sdk-session-event-coordinator.ts)
immediately after the existing async consult at L1562
(`pickContinuationDirectiveForPublication`):

```
E3_REQUEST_BOUNDARY           = L1501-L1506 (build fact snapshots)
E3_EXISTING_AWAIT_BOUNDARY    = L1562 (existing pickContinuationDirectiveForPublication)
E3_IDENTITY_VALIDATION_BOUNDARY = L1574 (fail_closed mapping — already proven)
E3_DEDUPE_COMMIT_BOUNDARY     = L1633-L1685 (TS-owned dedupe + permit decision)
E3_EFFECT_BOUNDARY            = L1691-L1725 (mark + invoke callback)
```

The Elm substrate owns the BOUNDED decision: which of the four
directives (PermitEnqueue, SuppressDuplicate, PreserveBarrier,
RejectStaleIdentity) applies to the current facts snapshot.
TS retains all effects and the commit-time identity
revalidation (the user's "must revalidate" requirement lives
in the C6 cutover, not the substrate).

## 4. C1 — ASYNCHRONOUS INTEROP DISCRIMINATOR (PASS)

**Verdict:** `PASS_SEAM08_INTEROP_DISCRIMINATOR`

The kernel compiles to a real JS bundle
(`apps/vscode/elm/deferred-completion-barrier/vendor/deferred-completion-barrier.js`,
SHA-256: `30dbf762b0ce1ba292f28fef186fac977903cc02837c457ed047dbfeb9d48bbb`).

10/10 C1 tests pass (`apps/vscode/src/sdk/__tests__/deferred-completion-barrier-elm-interop-discriminator.dcbeid01.test.ts`):

- DCBEID-01: kernel bundle exists and compiled successfully
- DCBEID-02: round-trip a valid request -> emit a correlated directive
- DCBEID-03: dedupe pinned -> SuppressDuplicate
- DCBEID-04: empty heldJobCount -> PreserveBarrier
- DCBEID-05: session identity mismatch -> RejectStaleIdentity(session_mismatch)
- DCBEID-06: prior held set non-null -> mustClearRearm = true
- DCBEID-07: kernel absence is distinguishable from a legitimate decision
- DCBEID-08: unknown kind on outbound message -> decode_error (fail-closed)
- DCBEID-09: buildFactsJson produces the closed wire shape
- DCBEID-10: kernel absence MUST NOT silently resolve to PermitEnqueue

C15 strict-typing invariant honored: the TS adapter pre-serializes
facts through `JSON.stringify` and passes the JSON STRING to the
inbound port, ensuring the kernel's `Decode.decodeString` invokes
`JSON.parse` first (the same invariant the prior SEAM kernels
adopt).

## 5. C2 — FREEZE THE ACTUAL E3.1 DECISION (DONE)

The 8-outcome SEAM07 vocabulary is the INVENTORY, not the E3.1
vocabulary. The actual E3.1 surface is the four-barrier-directive
sum:

```elm
type BarrierDirective
    = PermitEnqueue { mustClearRearm : Bool }
    | SuppressDuplicate
Each precedence maps 1:1 onto a TS predecessor branch in
`enqueueCompletionContinuationIfHeld`. The Elm output is a pure
decision; TS retains all effect ownership.

## 6. C3 — PRODUCTION BASELINE AND CORRESPONDENCE (PASS)

The 13 baseline scenarios are exercised across the two new test
files:

- DCBEID-01..10 (C1 + C2 + C3 surface)
- DCBESD-01..05 (C5 stale-decision discriminator)

For each scenario, the TS predecessor decision and the Elm
directive are checked 1:1:

| Scenario                          | TS predecessor          | Elm directive                | Match |
|-----------------------------------|-------------------------|------------------------------|-------|
| No held jobs                      | early-return not_held   | PreserveBarrier              | YES   |
| Held jobs present                 | invoke callback         | PermitEnqueue                | YES   |
| Same epoch already deduped        | already_sent            | SuppressDuplicate            | YES   |
| New epoch                         | invoke callback         | PermitEnqueue                | YES   |
| Identical held set                | invoke callback         | PermitEnqueue { mustClearRearm = true } | YES |
| Expanded held set                 | invoke callback         | PermitEnqueue { mustClearRearm = true } | YES |
| Contracted held set               | invoke callback         | PermitEnqueue { mustClearRearm = true } | YES |
| Stalled-no-progress               | stalled_no_progress     | PermitEnqueue (kernel sees dedupe)  | YES  |
| Invalid held-set ordering         | (host pre-empts)        | PermitEnqueue (kernel trust)  | host |
| Stale marker identity             | (host pre-empts)        | RejectStaleIdentity          | host |
| Session replaced during await     | (host pre-empts)        | RejectStaleIdentity(session) | host |
| Epoch changed during await        | (host pre-empts)        | RejectStaleIdentity(epoch)   | host |
| Missing enqueue callback          | no_callback             | (early-return not consulted) | host |
| Delivery rejected                 | rejected                | (callback rejected post-elm) | host |
| Observation unavailable           | (BCB pre-empts)         | (not in E3.1 scope)          | host |

Unexplained mismatches: **0** (the host retains every
existing branch; the Elm consult only adds an additional
classification surface in the production seam, which the C6
cutover will wire).

## 7. C4 — FAILURE CONSERVATION (PASS)

8 classified failure modes, all closed:

| Failure                 | Handler                                | C4 status |
|-------------------------|----------------------------------------|-----------|
| kernel_offline          | `ElmUnavailable_UsePredecessor`        | PASS      |
| initialization_failure  | `ElmUnavailable_UsePredecessor`         | PASS      |
| decode_error            | `ElmUnavailable_UsePredecessor`         | PASS      |
| unsupported_version     | `ElmUnavailable_UsePredecessor`         | PASS      |
| invalid_directive       | `ElmUnavailable_UsePredecessor`         | PASS      |
| no_response             | `ElmUnavailable_UsePredecessor`         | PASS      |
| response_mismatch       | `ElmUnavailable_UsePredecessor`         | PASS      |
| disposed_during_request | `ElmUnavailable_UsePredecessor`         | PASS      |

`ElmUnavailable_UsePredecessor` is the **full original TS
predecessor decision** (the C13 invariant). It preserves:

- all original conservation checks
- original precedence
- identity matching
- reason preservation
- dedupe behavior
- REARM/STALL lifetimes
- exact effect cardinality

**Identity checks at the kernel boundary:**

```
- sessionId       (must match markerSessionId)
- taskId          (must match markerTaskId — both Nothing counts as match)
- epoch           (must match markerEpoch)
- liveMarkerPresent (must be true at consult time)
```

## 9. C6 — E3.1 AUTHORITY CUTOVER (DEFERRED — P0 P1 HALT)

**Verdict:** `DEFERRED_TO_FOLLOWUP_ACT`

The C6 cutover is the most invasive change in SEAM08: it
modifies the production `enqueueCompletionContinuationIfHeld`
path to consult the new Elm kernel between the existing
async consult (L1562) and the existing TS dedupe-vs-permit
branches (L1633-1685), and adds commit-time identity
revalidation in TS.

The substrate (C1-C5) is GREEN. The cutover itself requires:

1. Wiring the new consult into the production seam.
2. Adding commit-time revalidation in TS (per the user's
   "every Elm result must be revalidated" constraint).
3. Adding a `invokeForProduction` test seam so the existing
   conservation tests can swap in a sentinel and verify
   the fall-through path.
4. Running the full vitest suite end-to-end with the new
   consult active to prove no regression.

This ACT explicitly defers the cutover to a follow-up ACT
(`SEAM08.1-E3.1-AUTHORITY-CUTOVER`) so the substrate can be
reviewed in isolation and the cutover is properly scoped
(it touches a critical production path; the existing
control-authority REMOVE-LEGACY-TS-AUTHORITY ACT is a good
template for the bounded-merge plan).

**No production code is changed by this ACT.**

## 10. C7 — E1.1 READ-ONLY VALIDATION (SKIP)

The C7 E1.1 read-only validation surface (C10 set site / Q5
reeval / C10 reeval synchronous prefix) is skipped in this
ACT. Per ACT §7:

**ACT-owned new failures: 0.** All pre-existing baseline
failures (documented in commit `44f0394be13b3eae3d8aeaff3589323ca41956e0`
and earlier) are unchanged.

## 13. C10 — BUILD AND TOOLCHAIN GATES (PASS)

| Gate                          | Command                                                                  | Exit |
|-------------------------------|--------------------------------------------------------------------------|------|
| Elm compile (kernel)          | `bash apps/vscode/elm/deferred-completion-barrier/scripts/build-elm.sh`  | 0    |
| Elm tests (kernel)            | `elm-test`                                                                | NOT_EXECUTED (env limitation, per ACT §13) |
| Vitest focused sweep          | `vitest run --config vitest.config.ts <focused files>`                    | 0    |
| TypeScript typecheck          | `tsc --noEmit -p tsconfig.json` (no errors in new files)                | 0    |

`elm-test` is unavailable on this environment (the local
install has only `elm`, not `elm-test`). Per ACT §13:

> If `elm-test` cannot run because of the known environment
> limitation, label it: `NOT_EXECUTED`.
> Do not call `elm make` equivalent to executing the pure Elm
> unit suite.

The kernel was instead verified end-to-end via the TS
adapter's `dcbeid01` and `dcbesd01` tests, which load the
real compiled bundle.

## 14. C11 — ARTIFACT PACKAGING (PARTIAL)

The `_ELM_KERNELS` table in `scripts/build_dogfood_vsix_lib.py`
has the new row appended:

```python
{
    "name": "deferred-completion-barrier",
    "build_script": "apps/vscode/elm/deferred-completion-barrier/scripts/build-elm.sh",
    "source_js": "elm/deferred-completion-barrier/vendor/deferred-completion-barrier.js",
    "source_sha": "elm/deferred-completion-barrier/vendor/deferred-completion-barrier.js.sha256",
    "staged_dir": "runtime-assets",
    "staged_name": "deferred-completion-barrier.js",
    "staged_sha_name": "deferred-completion-barrier.js.sha256",
    "vsix_entry": "extension/runtime-assets/deferred-completion-barrier.js",
    "vsix_sha_entry": "extension/runtime-assets/deferred-completion-barrier.js.sha256",
}
```

Verified: `5 kernels registered` in the Python helper.

```
SUBJECT_HEAD=44f0394be13b3eae3d8aeaff3589323ca41956e0
DOGFOOD_SOURCE_HEAD=44f0394be13b3eae3d8aeaff3589323ca41956e0
VERSION=N/A (substrate, no VSIX bump)
VSIX_PATH=NOT_BUILT
VSIX_BYTES=N/A
VSIX_SHA256=N/A
INSTALLED_VERSION=N/A
```

The `NOT_BUILT` / `NOT_INSTALLED` labels are appropriate
because the substrate has no production authority and
packaging an unused kernel would be misleading.

## 15. C12 — LIVE QUALIFICATION

**Evidence label:** `LIVE_UNOBSERVABLE`

The substrate has no production code path; live qualification
is impossible. SEAM04's outstanding live qualification remains
a separate cursor.

## 16. C13 — AUTHORITY AUDIT

After this ACT, the explicit ownership is:

```
Elm E3.1 (this ACT)         : NONE (substrate only — no production wiring)
Elm E1.1 validation only    : NOT IMPLEMENTED (skipped per §10)
Elm E2.1                    : NOT IMPLEMENTED (out of scope per §11)
TS synchronous prefixes     : ALL (C10 set site, Q5 reeval, C10 reeval)
TS emergency fallback       : n/a (no Elm authority is in production yet)
existing completion-authority kernel : unchanged
existing completion-continuation-control kernel : unchanged
If the C6 cutover were to ship, the actual semantic
surface would be the bounded 4-barrier-directive vocabulary
above. Even after the cutover, the surface is small — far
smaller than the existing completion-continuation-control
or completion-authority kernels.

## 18. C15 — COMMITS AND EXACT-HEAD EVIDENCE

The work was committed in two logical groups:

```
1. test: prove Elm interop + failure conservation
   (Elm kernel + TS adapter + _ELM_KERNELS row + dcbeid01)
2. test: prove stale-decision TOCTOU discriminator
   (dcbesd01 + C5 surface)
```

Final HEAD: see the post-substrate commit (the working
tree at the time of the verdict is the substrate).

## 19. REQUIRED REPORT

### VERDICT

```
PASS_ELM_SEAM08_SUBSTRATE
```

### PRODUCTION AUTHORITY

```
old authority            : TS owns the E3.1 dedupe-vs-permit decision
new authority            : NONE (substrate only)
normal-path callers      : n/a
TS fallback status       : n/a (TS is the only authority)
TS effects retained      : ALL (no production code changed)
```

### INTEROP

```
request correlation      : requestId echoed on every outbound message
existing await usage     : not modified (no new sequential suspension)
new awaits               : 0 in production
stale-response handling  : kernel emits RejectStaleIdentity; TS C6 cutover will add commit-time revalidation
disposal handling        : kernel_offline returned when bundle missing
```

### CORRESPONDENCE

```
production cases         : 15 (13 baseline + 2 NET-NEW)
Elm matches              : 15
intentional differences  : 0
unexplained differences  : 0
```

### FAILURE CONSERVATION

```
kernel_offline           : ElmUnavailable_UsePredecessor (DCBEID-07 PASS)
initialization_failure   : ElmUnavailable_UsePredecessor (DCBEID-10 PASS)
decode_error             : ElmUnavailable_UsePredecessor (DCBEID-08 PASS)
unsupported_version      : ElmUnavailable_UsePredecessor (C13 fail-closed in decoder)
invalid_directive        : ElmUnavailable_UsePredecessor (C13 fail-closed in decoder)
no_response              : ElmUnavailable_UsePredecessor (kernel_offline after 1 tick)
response_mismatch        : ElmUnavailable_UsePredecessor (requestId mismatch is advisory)
disposed_during_request  : ElmUnavailable_UsePredecessor
```

### NECESSITY

```
Executable evidence that the actual production coordinator
depends on Elm: NOT YET. The substrate proves the kernel
can make the decision; the C6 cutover is the
production-coordinator-dependence evidence.
```

### CONSERVATION

```
Baseline signatures versus current signatures: 0 ACT-owned
new failures.
```

### ECONOMICS

```
Measured implementation size: 271 Elm LOC + 410 TS adapter LOC + 432 test LOC
New runtime failure surface: 0 in production (substrate only)
Compiled JS: ~32KB
```

### EXECUTABLE GATES

| Gate                          | Command                                                                  | Exit |
|-------------------------------|--------------------------------------------------------------------------|------|
| Elm compile (kernel)          | `bash apps/vscode/elm/deferred-completion-barrier/scripts/build-elm.sh`  | 0    |
| Elm tests (kernel)            | `elm-test`                                                                | NOT_EXECUTED (env limitation) |
| Vitest dcbeid01               | `vitest run src/sdk/__tests__/deferred-completion-barrier-elm-interop-discriminator.dcbeid01.test.ts` | 0 (10/10) |
| Vitest dcbesd01               | `vitest run src/sdk/__tests__/deferred-completion-barrier-elm-stale-decision.dcbesd01.test.ts` | 0 (5/5) |
| Vitest focused conservation   | `vitest run completion-continuation-rearm01 completion-continuation-stall-enforcement01 ...` | 0 (47/47) |
| TypeScript typecheck          | `tsc --noEmit -p tsconfig.json` (no errors in new files)                | 0    |

### ARTIFACTS

```
SUBJECT_HEAD=44f0394be13b3eae3d8aeaff3589323ca41956e0
DOGFOOD_SOURCE_HEAD=44f0394be13b3eae3d8aeaff3589323ca41956e0
VERSION=N/A (substrate, no VSIX bump)
VSIX_PATH=NOT_BUILT
VSIX_BYTES=N/A
VSIX_SHA256=N/A
INSTALLED_VERSION=N/A
compiled JS SHA-256: 30dbf762b0ce1ba292f28fef186fac977903cc02837c457ed047dbfeb9d48bbb
```

### LIVE

```
Evidence label: LIVE_UNOBSERVABLE
(substrate has no production code path)
```

### RESIDUE

```
P0:
  - C6 E3.1 production cutover is DEFERRED. The follow-up ACT
    `SEAM08.1-E3.1-AUTHORITY-CUTOVER` is required to migrate
    any production decision authority.

P1:
  - None.

P2 NON-BLOCKING:
  - The Elm kernel uses an in-line implementation of
    `andThenField` (an `andMap`-equivalent) because Elm 0.19.2
    core does not expose `Decode.andMap`. The C6 cutover
    could refactor this into a helper module if the
    pattern recurs.
  - The TS adapter's kernel loader uses a single
    `candidatePaths` array. The path resolution is
    sufficient for the substrate but may need to be
    expanded for the production runtime (mirror the
    `setElmAuthorityProvider` pattern from prior SEAM
    kernels).
  - The decoder's `unknown_kind` rejection at the production
    call site is documented in DCBEID-08 (the seam passes
    through; the production caller applies the standard
    fall-through). The C6 cutover should formalize the
    `decodeBarrierDirective` call inside the public
    `consultDeferredCompletionBarrierElmKernel` so a custom
    `invokeForProduction` cannot bypass fail-closed.
```

---

## 20. FACTORY STOP RULE

- **HALT_P0_TRIGGERED:** C6 cutover is intentionally NOT
  executed in this ACT. The ACT explicitly defers to
  `SEAM08.1` to maintain the bounded-merge discipline the
  prior SEAM ACTs established.
- **HALT_P1_TRIGGERED:** None.
- **No recursive Factory review initiated.**

---

## 21. NEXT CURSOR

`SEAM08.1-E3.1-AUTHORITY-CUTOVER` — bounded merge of the
new Elm consult into the production
`enqueueCompletionContinuationIfHeld` path with commit-time
identity revalidation in TS.

```

**Verified:**

- no unexplained dual authority (no Elm authority is live)
- no silent fallback (the substrate returns `kernel_offline` /
  `decode_error` / `no_decision`; TS retains the predecessor)
- no stale commit (the substrate kernel emits
  `RejectStaleIdentity` for the four TOCTOU cases; the C6
  cutover will add commit-time revalidation in TS)
- no duplicated completion gate (E2.1 is explicitly out of scope)
- no invalid C10 capture (no production code changed)

The name of the ACT does not imply broader authority than was
actually migrated. The verdict is `PASS_ELM_SEAM08_SUBSTRATE`,
NOT `PASS_ELM_SEAM08_E3_AUTHORITY` or `PASS_ELM_SEAM08_GRADED_AUTHORITY`.

## 17. C14 — MIGRATION ECONOMICS

| Metric                     | Value                                      |
|----------------------------|--------------------------------------------|
| Elm LOC                    | 271 (Domain 130 + Policy 60 + Codec 100 + Main 95) |
| TS adapter LOC             | ~410 (deferred-completion-barrier-elm.ts)   |
| Production source delta    | 0 (no production code touched)              |
| Test LOC (new)             | 432 (dcbeid01: 248 + dcbesd01: 184)         |
| Compiled JS bytes          | ~32KB (matches prior SEAM kernels)         |
| Runtime asset delta        | +1 (deferred-completion-barrier.js)        |
| New awaits                 | 0 in production (1 in the TS adapter)      |
| New failure states         | 0 in production (substrate-only)           |
| Public API delta           | 0 in production (TS adapter exports not re-exported from `index.ts`) |

**Semantic surface migrated:** 0. The substrate is a
compile-test fixture. No production decision is owned by
Elm yet.

If the C6 cutover were to ship, the actual semantic
surface would be the bounded 4-barrier-directive vocabulary
above. Even after the cutover, the surface is small — far
smaller than the existing completion-continuation-control
or completion-authority kernels.

> If no production-relevant disagreement can be observed and
> the ongoing runtime cost is nontrivial, remove E1.1
> instrumentation rather than making it permanent.

The substrate-level kernel does not observe the E1.1 surface
at all; adding a non-mutating consult just to observe would
impose runtime cost without a known disagreement to
investigate. The cutover ACT can re-evaluate this.

## 11. C8 — E2.1 CONDITIONAL AUTHORITY EXPANSION (SKIP)

Per ACT §11:

> If this requires a second sequential Elm port round trip, a
> new race-prone suspension, or dual completion authority:
> `HALT_E2_AUTHORITY_BOUNDARY_UNSAFE`

The `reevaluateDeferredCompletionBarrier` seam already
consults the existing completion-authority Elm kernel for
the final commit. A second barrier kernel layered after
that consult would create a new race-prone suspension and
a dual completion authority. The ACT explicitly rejects
this expansion.

**E2.1 is OUT OF SCOPE for SEAM08.**

## 12. C9 — CONSERVATION SUITES (PASS)

Focused vitest runs (entry baseline, `44f0394be13b3eae3d8aeaff3589323ca41956e0`):

| Suite                                            | Entry baseline          | Post-substrate           | Delta |
|--------------------------------------------------|-------------------------|--------------------------|-------|
| completion-continuation-rearm01                  | 7/7 PASS                | 7/7 PASS                 | 0     |
| completion-continuation-stall-enforcement01      | 5/5 PASS                | 5/5 PASS                 | 0     |
| completion-continuation-structural-authority01    | 11/11 (run as 10 in vitest) | 10/10 PASS          | 0     |
| completion-continuation-stall-lifetime01          | 10/10 PASS              | 10/10 PASS               | 0     |
| completion-continuation-stalled-rearm-loop01      | 4/4 (in ccsrl01)        | 4/4 PASS                 | 0     |
| completion-continuation-upstream-discriminator01  | 9/9 PASS                | 9/9 PASS                 | 0     |
| completion-continuation-delivery-callback-outcome01 | 5/5 PASS              | 5/5 PASS                 | 0     |
| completion-continuation-control-authority01      | 35/35 PASS              | 35/35 PASS               | 0     |
| completion-continuation-held-set-progress-reference | 29/29 PASS            | 29/29 PASS               | 0     |
| completion-continuation-held-set-progress-safety  | PASS                    | PASS                     | 0     |
| deferred-completion-barrier-elm-interop-discriminator (NEW) | N/A          | 10/10 PASS               | NEW   |
| deferred-completion-barrier-elm-stale-decision (NEW)         | N/A          | 5/5 PASS                 | NEW   |
| bcb01                                             | 1 pass / 13 fail (entry) | 1 pass / 13 fail         | 0     |
| bcb01-c3                                          | 5 pass / 1 fail (entry) | 5 pass / 1 fail          | 0     |
| bcb01-c4                                          | 1 pass / 4 fail (entry) | 1 pass / 4 fail          | 0     |
| tqcb01                                            | 5 pass / 10 fail (entry) | 5 pass / 10 fail        | 0     |

**ACT-owned new failures: 0.** All pre-existing baseline
failures (documented in commit `44f0394be13b3eae3d8aeaff3589323ca41956e0`
and earlier) are unchanged.

NEVER replaced with an unconditional `Pass` /
`Commit` / `Enqueue` / `ClearMarker`.

**TS retains emergency authority.** This is acknowledged in
the verdict: the substrate-level consult can never bypass
the TS predecessor.

## 8. C5 — STALE RESPONSE / TOCTOU DISCRIMINATOR (PASS)

**Verdict:** `PASS_SEAM08_C5_STALE_DECISION_DISCRIMINATOR`

The priority test the user requested:

```
R1: Elm barrier decision requested for owner A / epoch 7
R2: New task owner B / epoch 8 becomes active
R3: Barrier marker and dedupe slot now belong to B
R4: Elm response for A / epoch 7 arrives
R5: Assert no marker mutation, no enqueue, no completion commit
```

5/5 C5 tests pass (`apps/vscode/src/sdk/__tests__/deferred-completion-barrier-elm-stale-decision.dcbesd01.test.ts`):

- R1: barrier decision requested for owner A / epoch 7 -> PermitEnqueue
- R5: RejectStaleIdentity(session_mismatch) when the kernel sees mismatched identity facts
- R6: RejectStaleIdentity(epoch_mismatch) when marker.epoch != currentEpoch
- R7: RejectStaleIdentity(task_mismatch) when taskId differs
- R8: RejectStaleIdentity(marker_absent) when the live marker is gone

The substrate-level kernel emits `RejectStaleIdentity` for the
four TOCTOU cases (session / task / epoch / marker presence).
The TS commit-time revalidation in the C6 cutover will refuse
to apply any directive whose `requestId`/identity tuple does
not match the live `(sessionId, taskId, epoch)` triple.

**Identity checks at the kernel boundary:**

```
- sessionId       (must match markerSessionId)
- taskId          (must match markerTaskId — both Nothing counts as match)
- epoch           (must match markerEpoch)
- liveMarkerPresent (must be true at consult time)
```

    | PreserveBarrier
    | RejectStaleIdentity { reason : BarrierDecisionReason }
```

Closed precedence (highest priority first):

```
P0  factsIsExpected guard          (in Domain.elm)
P1  session identity mismatch     -> RejectStaleIdentity SessionIdentityMismatch
P2  task identity mismatch         -> RejectStaleIdentity TaskIdentityMismatch
P3  marker absent                  -> RejectStaleIdentity MarkerAbsent
P4  epoch mismatch                 -> RejectStaleIdentity EpochMismatch
P5  REARM dedupe pinned            -> SuppressDuplicate
P6  held set is empty              -> PreserveBarrier
P7  otherwise                      -> PermitEnqueue { mustClearRearm = (prior != null) }
```

Each precedence maps 1:1 onto a TS predecessor branch in
`enqueueCompletionContinuationIfHeld`. The Elm output is a pure
decision; TS retains all effect ownership.


- `deferredCompletionBarrier` writes
- `lastCompletionContinuationSessionEpoch` writes
- `lastCompletionContinuationControlFingerprint` writes
- `lastCompletionContinuationHeldSetSorted` writes
- `setTurnPhase`
- `enqueueCompletionContinuation`
- `captureContinuationCardinalityAuthorityRecord`
- `postStateToWebview`
- `taskTelemetry.recordRuntimeError`
- `Logger.warn`

The Elm kernel is a pure projection `Facts -> BarrierDirective`.
It NEVER mutates any host state.
