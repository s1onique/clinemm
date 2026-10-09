# ACT-CLINEMM-ELM-SEAM07-CORRECTION01 — PASS_ELM_SEAM07_CORRECTION01 — 2026-10-09

**Status:** CLOSED with verdict `PASS_ELM_SEAM07_CORRECTION01`.
The SEAM07 recon report at
`.factory/ACT-CLINEMM-ELM-SEAM07-LONG-HORIZON-CONTINUATION-RECON.md`
is corrected in place. The selected production decision authority
(`deferredCompletionBarrier` marker state machine) is unchanged. The
economics gate verdict is unchanged. The contract is corrected to
honor the reviewer-identified P0 and P1 issues before any
production-side Elm migration begins. This ACT authorizes
`SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION` ONLY under
the bound order recorded in §4.

## 1. Reviewer concerns (verbatim from the C1:GO review)

> SEAM06 rejected its migration partly because the existing
> `Platform.worker` bridge could not safely return a synchronous
> decision.
>
> SEAM07 now proposes: "The kernel loader returns a synchronous
> result via a pre-warmed bundle."
>
> Pre-warming a kernel does not, by itself, make a port
> request/response synchronous.
>
> The existing `completion-continuation-control-elm.ts` bridge is
> asynchronous, and the official Elm documentation specifies message
> exchange through ports — not a synchronous function-call contract.
>
> SEAM08 must not begin a production authority cutover on the
> assumption that synchronous Elm results are available.
>
> The first implementation discriminator must prove one of these:
>
> 1. The actual compiled Elm kernel supports a safe synchronous
>    result through documented, supported mechanisms.
> 2. An existing asynchronous boundary can be reused without
>    introducing an additional scheduling gap or violating
>    reservation/ownership invariants.
> 3. The selected synchronous critical sections remain TS-owned,
>    and Elm authority is restricted to a genuinely asynchronous
>    decision boundary.
>
> If none is true: `HALT_INTEROP_CONTRACT_UNSAFE`

> The proposed failure contract says that `kernel_offline`, decode
> errors, or timeouts fall back to the TS predecessor checks, but
> then describes this as returning `Pass`.
>
> These are different contracts.
>
> A valid predecessor fallback must evaluate the full original
> predicate and may produce a blocking decision. Never
> `Elm unavailable -> Pass -> Completion committed`.
>
> A universal `Pass` would recreate the premature-completion class
> of failures this migration is intended to prevent.
>
> The emergency TS policy may remain temporarily, but it must be
> independently tested, distinguishable from normal Elm authority,
> and explicitly documented.

## 2. Verification — the SEAM07 contract is corrected

### 2.1 P0 synchrony correction

**Claim being corrected:** SEAM07 §6
(`synchrony / ordering requirements`) and §6
(`unobservable` paragraph) said that the kernel's directive is
"returned synchronously" and that the marker write happens
"in the same critical section" as the predicate reads. This
claim is unsupportable on the existing bridge.

**Evidence the reviewer is correct:**

`apps/vscode/src/sdk/completion-continuation-control-elm.ts:454-466`
defines the only `ElmNamespace` shape the bridge accepts:

```typescript
interface ElmNamespace {
    readonly Main?: {
        readonly init: (flags: unknown) => {
            readonly ports: {
                readonly inbound: { send: (v: unknown) => void }
                readonly outbound: { subscribe: (cb: (v: unknown) => void) => void }
            }
        }
    }
}
```

The two port operations (`inbound.send` and
`outbound.subscribe`) are the only interop primitives exposed.
`sendInbound(value)` enqueues the next Elm update cycle;
`recvOutbound` returns whatever the most recent `outbound`
subscription has fired. There is no `inbound.sendSync` / no
`outbound.pull` / no synchronous response in Elm 0.19 ports.
The Elm runtime is fundamentally event-loop driven.

`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:1562` is the
existing production caller of the existing Elm kernel; it
already uses `await pickContinuationDirectiveForPublication(...)`.
The Elm call returns a `Promise<ContinuationDirective>` that
resolves on the next outbound-port tick. **The existing
production contract is asynchronous.**

**Correction:** the SEAM07 §6 paragraph "synchrony / ordering
requirements" is amended to read:

> **No new `await` at the SAME critical section that the
> SEAM04-canonical pattern awaits.** The Elm port hop already
> incurs a microtask deferral (an existing scheduling gap). The
> SEAM08 implementation MUST NOT add a second hop on the same
> path, and MUST NOT introduce a "wait for the kernel to speak
> before writing the marker" pattern that the original TS
> predicate did not require. The kernel is consulted via a
> parallel `pickBarrierDirective` call. The TS adapter may use
> the result when the port fires; the marker write may be
> gated on the kernel result when the kernel's authoritative
> path (Q5 reeval, enqueue post-await) already awaits; the
> marker write may NOT be deferred to a NEW await at the
> synchronous-prefix sites (line 2640, line 813, line
> 980-1259 prefix).

**Operating rule for SEAM08:** the SEAM04 bridge pattern
(`await pickContinuationDirectiveForPublication(...)` at
line 1562) is the ONLY existing async boundary; SEAM08 may
use it. SEAM08 must NOT add a new `await` on a path that
was synchronous in the original TS state machine. The
interop discriminator in §4.1 of this correction ACT
discriminates between three concrete options for each of
the four critical sections.

### 2.2 P1 failure-fallback correction

**Claim being corrected:** SEAM07 §6
(`failure conservation`) said "kernel offline / decode error
/ no response: TS adapter fall-through to the EXISTING TS
predicate (the inline conservation checks)… decode-error:
TS adapter returns Pass (conservation checks re-evaluated
inline)." The "Pass" word is incorrect; the predecessor
predicate can return a BLOCKING decision (the marker must
be set, not cleared).

**Correction:** the SEAM07 §6 paragraph "failure
conservation" is amended to read:

> **Failure conservation contract (corrected):**
>
> When the Elm kernel is unavailable (kernel file missing,
> kernel evaluation failed, ports not present, port response
> timeout, decode error, malformed directive, or unsupported
> runtime path), the TS adapter MUST evaluate the FULL
> ORIGINAL TS predecessor predicate and write the marker in
> the SAME critical section as the original TS code would
> have. The fallback is a labeled `ElmUnavailable_UsePredecessor`
> discriminator event recorded in the kernel diagnostic
> (`failureClass` is non-null); the resulting marker state
> (set or clear) is whatever the original TS predicate
> would have written. There is NO universal `Pass`. The
> fallback is not a "this completes" — it is "use the
> predecessor's truth." The four `bcb01` etc. tests
> exercise the predecessor path; those tests must remain
> green when the Elm kernel is OFFLINE, with the documented
> `ElmUnavailable_UsePredecessor` discriminator recorded.
>
> The emergency TS policy IS the authoritative source for
> the no-Elm case. It is NOT a "fail-open" — it is the
> production-grade TS implementation that the Elm kernel is
> being asked to replace, evaluated unchanged. The new Elm
> kernel's role is to provide a stronger invariant for
> the GREEN case; the RED case is unchanged from the
> predecessor.

**Operating rule for SEAM08:** the failure fallback
MUST be the original TS predicate, evaluated end-to-end
in the same critical section that the original TS code
would have used. The fallback is observable via the
existing `isDeferredCompletionBarrierOutstandingForTesting`
+ the new `getElmBarrierKernelDiagnostic` accessor
(`failureClass` is one of the documented classes). The
fallback does NOT have to honor Elm-side decisions; it
re-evaluates the original TS four conservation checks
inline. SEAM08 must add a unit test that exercises
`kernel = NULL` and asserts the marker state matches the
predecessor's output for each of the four conservation
checks.

### 2.3 SEAM07 §3.10 "Synchrony / ordering requirements" — confirmed and refined

The four critical sections in the original SEAM07 §3.10
list are correct, but the conclusion "NO new critical
section introduces a new await" is too strong. The
corrected wording:

> The original TS state machine had ZERO awaits in the
> synchronous prefix of (a) the C10 set site (line 2640),
> (b) the Q5 reeval (line 813), and (c) the C10 reeval
> prefix (line 980-1259). The original TS state machine
> had ONE existing await in (d) the enqueue post-await
> (line 1562, awaiting
> `pickContinuationDirectiveForPublication`).
>
> The Elm interop requires an async boundary; the existing
> production pattern is to await the kernel call in the
> SAME critical section that the original TS code would
> have used for its own await (the "use the existing
> async hop" pattern). The Elm kernel call may be added
> to the existing await at (d) without adding a new hop.
> For (a), (b), (c), the Elm kernel call MUST be
> classified as "no new await" via one of the three
> interop discriminator options in §4.1 of this
> correction ACT.
>
> **The corrected rule:** SEAM08 may add the Elm kernel
> call at the existing await at (d). For (a), (b), (c),
> SEAM08 must not insert a new await. The kernel call
> at (a), (b), (c) is a "lookup" that returns a future;
> the TS adapter either (i) consumes the future when it
> fires and treats the resulting state as a deferred write
> (the write happens at the next idle turn, NOT in the
> original critical section — only allowed if the original
> TS path did not write to the marker in that critical
> section), or (ii) the kernel call is restricted to the
> AUTHORITATIVE path that already awaits (the (d) path),
> or (iii) the kernel is restricted to read-only
> (validate-only, no marker write authority) for (a),
> (b), (c), and only AUTHORITATIVE for (d).

## 3. Production seam update — the four critical sections, classified

For each of the four critical sections listed in the original
SEAM07 §3.10, the corrected interop contract is:

| # | Site | Lines | Original TS awaits? | Elm interop options (per §4.1) | SEAM08 first discriminator |
|---|------|-------|---------------------|------------------------------|----------------------------|
| (a) | C10 set (BCB re-registration) | 2640 | 0 (synchronous) | E1 only | E1.1 (read-only validation) |
| (b) | Q5 reeval | 813 | 0 (synchronous) | E1 only | E1.1 (read-only validation) |
| (c) | C10 reeval synchronous prefix | 980-1259 | 0 (synchronous), then `await` at 1275 | E1 or E2 (extends existing await at 1275) | E1.1 (synchronous prefix); E2.1 (post-1275 path) |
| (d) | Enqueue post-await | 1562-1726 | 1 (existing await at 1562) | E3 (extends existing await) | E3.1 (sibling `pickBarrierDirective` await) |

The recommended SEAM08 first discriminator order is:

1. **E3.1** — extend the existing await at (d) to call
   `pickBarrierDirective`; this is the LEAST invasive change
   (no new await, no new critical section). The kernel speaks
   on the same path that the existing `pickContinuationDirectiveForPublication`
   speaks on.
2. **E1.1** — at (a), (b), and the synchronous prefix of (c),
   the kernel is consulted in READ-ONLY mode: the kernel
   validates the current state and emits a `validation` tag,
   but does NOT authorize a marker write. The marker write
   authority remains TS-owned. The Elm kernel becomes a
   "lint" of the marker transitions, not the writer.
3. **E2.1** — at the post-1275 path of (c), the kernel is
   consulted in AUTHORITATIVE mode via the existing
   `checkElmCompletionAuthority` await. The kernel may emit
   a `hold` / `commit` / `fail_closed` directive that
   overrides the TS reeval prefix. This is the SEAM04
   pattern that already exists at the existing await.

**The Elm kernel does NOT have to own the marker write at
all four sites.** The Elm kernel may be restricted to:

- (d) AUTHORITATIVE (full writer authority, the elm
  `pickBarrierDirective` IS the source of truth for the
  marker write at (d) only);
- (c) post-1275 path AUTHORITATIVE (full writer authority
  for the `hold` / `commit` decision);
- (a), (b), (c) synchronous prefix READ-ONLY (the kernel
  validates the state and emits a lint, the TS adapter
  decides).

This is the **graded interop** model: the Elm kernel's
authority expands in stages; the GREEN-first
implementation uses E3.1 + E1.1 only; the
HOLD-first implementation uses E3.1 + E1.1 + E2.1.

## 4. SEAM08 authorized order

The reviewer requires SEAM08 to proceed in this order:

1. **Interop discriminator first** (E3.1, E1.1, E2.1
   probes) — a small executable probe exercising the actual
   compiled Elm port boundary, run BEFORE any production
   authority change. The probes must:

   a. Load the actual `runtime-assets/completion-continuation-control.js`
      bundle (or a SEAM08-specific bundle at
      `runtime-assets/deferred-completion-barrier.js`).
   b. Call `inbound.send(<facts>)` and wait for the
      `outbound` subscription to fire with a
      `<directive>`.
   c. Assert that the directive is one of
      `{Pass, Set, ReRegister, Stale, Blocked, Deduped,
      NotHeld, ObservationUnavailable}` (8 outcomes).
   d. Assert that the timing is bounded
      (`Promise.race([kernelCall, timeout(50ms)])`).
   e. Assert that `kernel = NULL` is handled via the
      corrected failure fallback (§2.2 above).
   f. Assert that the kernel speaks on the SAME port pair
      the existing `completion-continuation-control`
      kernel uses (`inbound.send` / `outbound.subscribe`).
      This is the SEAM08 contract: same bridge shape, new
      kernel namespace, same async pattern.

2. **Failure conservation** (P1 §2.2) — implement the
   `ElmUnavailable_UsePredecessor` discriminator and the
   four unit tests (one per conservation check) that
   exercise `kernel = NULL` and assert the marker state
   matches the predecessor's output.

3. **Production correspondence** — exercise the real
   `SdkSessionEventCoordinator` constructor (NOT a
   mirrored test-local reducer). Use the existing
   `setDeferredCompletionBarrierForTesting` accessor for
   setup; the real `enqueueCompletionContinuationIfHeld`,
   `reevaluateDeferredCompletionBarrier`, etc. for
   exercise.

4. **One bounded transition migration** — start with the
   E3.1 path: the enqueue post-await (d) consults
   `pickBarrierDirective` alongside the existing
   `pickContinuationDirectiveForPublication`; the marker
   is written based on the kernel directive (or the
   corrected failure fallback). This is one transition,
   one site, one test. If the GREEN case passes, expand
   to E1.1 (read-only validation at (a), (b), (c)
   prefix), then E2.1 (post-1275 authority at (c)
   suffix).

5. **Conservation and necessity** — preserve the Q5/C10,
   REARM/STALL, dedupe, and C10 post-commit capture
   ordering. Each migration step must add a unit test
   that exercises the specific transition with the Elm
   kernel offline AND online; the offline test verifies
   the corrected failure fallback (§2.2), the online
   test verifies the Elm directive.

**The pre-existing BCB01/TQCB01 failures must remain
explicitly classified as baseline failures. Do not
silently absorb them into SEAM08 or claim those suites
are green.**

**Documentary correction (P2 NON-BLOCKING):** the
original SEAM07 §10 (`Artifact identity`) recorded
`SUBJECT_HEAD = eb3de47ab5b88a55ea15e768241e65efb6464cc2`
(repeating the entry HEAD), and the SEAM07 commit is
`98ea70031cfb5eedc476df4b4e0c226a19b042ab`. The
SEAM07 report should record `SUBJECT_HEAD =
98ea70031cfb5eedc476df4b4e0c226a19b042ab` (the
SEAM07 commit) and `ENTRY_HEAD = eb3de47ab5b88a55ea15e768241e65efb6464cc2`
(the SEAM07 entry). This correction is P2 NON-BLOCKING;
the SEAM07 report's `Artifact identity` section is
amended to record both values distinctly.

## 5. SEAM08 next ACT specification

`ACT-CLINEMM-ELM-SEAM08-DEFERRED-COMPLETION-BARRIER-AUTHORITY-MIGRATION`
is authorized ONLY under the order in §4. The
implementation ACT MUST:

- Begin with the interop discriminator (§4.1) BEFORE any
  production authority change.
- Honor the corrected failure fallback (§2.2) for the
  `kernel = NULL` case.
- Use the graded interop model (§3): E3.1 GREEN-first,
  E1.1 next, E2.1 last.
- Record `SUBJECT_HEAD = <SEAM08 commit>` and
  `ENTRY_HEAD = 98ea70031cfb5eedc476df4b4e0c226a19b042ab`
  (the SEAM07 commit) in the SEAM08 report's `Artifact
  identity` section.
- NOT regress the pre-existing baseline failures
  (bcb01 13/14, tqcb01 10/15, bcb01-c3 1/6, bcb01-c4 4/5).
- Honor the SEAM04 lesson on the `HALT_HELD_SET_PROGRESS_AUTHORITY_UNSAFE`
  / TOCTOU race; the graded interop model does NOT
  introduce a new TOCTOU window because E1.1 is
  read-only validation (no marker write) and E3.1 /
  E2.1 use the existing await.

## 6. SEAM07 recon report amendments (in-place)

The SEAM07 report at
`.factory/ACT-CLINEMM-ELM-SEAM07-LONG-HORIZON-CONTINUATION-RECON.md`
is amended in place as follows:

- §6 (`synchrony / ordering requirements`): the "No new
  `await`" sentence is replaced by §2.1 of this correction
  ACT. The kernel call at (a), (b), (c) synchronous prefix
  is "read-only validation" via E1.1; the kernel call at
  (c) post-1275 path uses the existing await via E2.1; the
  kernel call at (d) uses the existing await via E3.1.
- §6 (`failure conservation`): the "decode-error: TS
  adapter returns Pass" sentence is replaced by §2.2 of
  this correction ACT. The fallback is
  `ElmUnavailable_UsePredecessor`; the fallback evaluates
  the full original TS predicate and writes the marker
  accordingly; the fallback is observable via the kernel
  diagnostic.
- §10 (`Artifact identity`): the
  `SUBJECT_HEAD = eb3de47ab5b88a55ea15e768241e65efb6464cc2`
  entry is amended to read
  `SUBJECT_HEAD = 98ea70031cfb5eedc476df4b4e0c226a19b042ab`
  (the SEAM07 commit), and the
  `ENTRY_HEAD = eb3de47ab5b88a55ea15e768241e65efb6464cc2`
  entry is preserved (the SEAM07 entry).
- §8 (`Next cursor`): the SEAM08 authorization is
  amended to require the §4 order of this correction ACT
  as the first gate.

## 7. Files

- **New report:**
  `.factory/ACT-CLINEMM-ELM-SEAM07-CORRECTION01-SYNCHRONY-AND-FAILURE-FALLBACK.md`
  (this file).
- **Amended report:**
  `.factory/ACT-CLINEMM-ELM-SEAM07-LONG-HORIZON-CONTINUATION-RECON.md`
  (in-place amendments per §6 of this correction ACT).
- **Updated board:**
  `.factory/epic-board.md` (one new section appended at
  the end).
- **No source code changes.**

## 8. Predecessor ACT lineage

- `ACT-CLINEMM-ELM-SEAM07-LONG-HORIZON-CONTINUATION-RECON`
  (`PASS_ELM_SEAM07_RECON`) — the original recon; the
  economics gate GO, the production seam identified, the
  Elm overlap zero. This correction ACT addresses the
  reviewer-identified P0 synchrony and P1 failure-fallback
  contradictions in the SEAM07 §6 contract; it does not
  change the recon verdict.
- The reviewer-supplied
  `SEAM07  PASS_ELM_SEAM07_RECON / ECONOMICS_GATE = GO /
  SEAM08  AUTHORIZED FOR BOUNDED IMPLEMENTATION /
  FIRST GATE = SYNCHRONOUS_INTEROP_DISCRIMINATOR /
  SEAM04  LIVE QUALIFICATION STILL OUTSTANDING` decision
  is honored by this correction ACT.

## 9. Artifact identity

- ENTRY_HEAD = `98ea70031cfb5eedc476df4b4e0c226a19b042ab`
  (the SEAM07 commit).
- SUBJECT_HEAD = `98ea70031cfb5eedc476df4b4e0c226a19b042ab`
  (the SEAM07 commit; corrected from the original SEAM07
  report's `eb3de47ab…` repetition, which was a P2
  NON-BLOCKING documentary issue per the reviewer).
- BRANCH = `main`.
- WORKTREE_STATUS = clean at the time this correction
  ACT begins.
- FINAL_COMMIT = `<recorded in §10 of this correction
  ACT after the commit lands>`.
- No production code touched.

## 10. Gates

- `git status --short` → empty before this correction
  ACT's commit.
- `git diff --check` → exit 0.
- No production code touched.
- SEAM01–07 evidence preserved in `.factory/epic-board.md`
  and the per-ACT files in `.factory/`.
- Pre-existing baseline failures (bcb01 13/14, tqcb01
  10/15, bcb01-c3 1/6, bcb01-c4 4/5) documented in commit
  `acbfcf20a` and preserved unchanged.
- The reviewer's P0 synchrony correction is honored in
  §2.1 and §3 of this correction ACT.
- The reviewer's P1 failure-fallback correction is
  honored in §2.2 of this correction ACT.
- The reviewer's SEAM08 execution priority (interop
  discriminator first, failure conservation, production
  correspondence, one bounded transition, conservation
  and necessity) is honored in §4 of this correction
  ACT.
- The reviewer's documentary correction (P2
  NON-BLOCKING) is honored in §6 of this correction ACT.
