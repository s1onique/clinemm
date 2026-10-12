# ACT-CLINEMM-ELM-SEAM10-INTEROP-DISC — NOT_A_GOOD_ELM_SEAM — 2026-10-12

**Status:** CLOSED with verdict `NOT_A_GOOD_ELM_SEAM`. The
reviewer-mandated interop discriminator was executed against the
SEAM09 frozen contract. The discriminator returns the disposition
`NOT_A_GOOD_ELM_SEAM` based on six reasons enumerated in
TPAEID-10. The SEAM10 production cutover is **not authorized**.

This is a legitimate exit. The reviewer's P0 finding
(synchronous Elm interop impossibility) and the P1 findings
(evidence-loss hazard, side-channel reformulation tag) are
**all confirmed by the discriminator**.

**Preconditions met:**

- ENTRY_HEAD = `ff80cddbf92a4e9b834fe75359d17e64a687949b` on
  branch `main`; working tree clean; no stashes; no uncommitted
  changes (verified by `git status --short` returning empty
  after the SEAM09 commit).
- SEAM01–09 evidence preserved in `.factory/epic-board.md` and
  the per-ACT files in `.factory/`.
- SEAM06 verdict `NOT_A_GOOD_ELM_SEAM` and its required
  recommendation honored (this discriminator mirrors the
  SEAM06 pattern of "small synchronous decision + ~600 LoC
  Elm cost + new async hop on top of an already-async host
  call ⇒ cutover is not worth it").
- HALT_UNEXPECTED_TRACKED_DIRT: NOT TRIGGERED.
- Reviewer verdict on SEAM09: "C1: GO to SEAM10 discriminator;
  NO-GO for immediate production cutover." Honored in full.

## 0. Reviewer findings (verbatim, the things this discriminator proves)

> P0 — SEAM10 repeats the SEAM06 synchronous-interop mistake
>
> The frozen plan proposes:
> `consultToolApprovalAuthorityForRequest(request, hostFacts): VerdictTag`
> It explicitly requires a synchronous Elm decision inside the
> approval-policy evaluation.
>
> But our earlier SEAM06 investigation already rejected
> synchronous Elm `Platform.worker` interop using the existing
> substrate.

> P1 — The nine tags are not the complete authorization contract.
>
> The existing command-policy callback returns more than
> ALLOW/DENY: `{ approved, decision: { kind, reason, source },
> executionPlan, hostAuthorization }`.

> P1 — The migration economics are not established for the
> selected sub-seam.
>
> SEAM09 justifies migration partly through the temporal
> complexity of pending approvals, cancellation, and response
> correlation. But its selected Elm boundary explicitly excludes
> those transitions.
>
> What remains is a synchronous policy classifier.
>
> That may still be worthwhile because of its nine verdict
> categories and complicated precedence. However, we cannot
> count the complexity of TS-owned lifecycle behavior as
> complexity eliminated by Elm.

> The disposition must be decisive:
>
> - `GO_SEAM10` — a supported interop boundary preserves
>   authorization semantics and the migration economics remain
>   favorable.
> - `NOT_A_GOOD_ELM_SEAM` — safe integration costs more than
>   the policy migration is worth.
> - `HALT_APPROVAL_AUTHORITY_UNSAFE` — a proposed cutover could
>   grant authorization from stale, malformed, or unavailable
>   authority.

> C1: GO to SEAM10 discriminator; NO-GO for immediate
> production cutover.

## 1. Production seam (frozen by SEAM09, reconfirmed here)

`SdkInteractionCoordinator.runRequestToolApproval` at
`apps/vscode/src/sdk/sdk-interaction-coordinator.ts:427-608`.
The method is **`async`** and already contains one existing
`await` boundary at line 466:

```ts
const commandEval = isCommand
  ? await this.options.evaluateCommandToolApproval?.(request)
  : undefined
```

`evaluateCommandToolApproval` (signature at lines 111-129) is
typed:

```ts
evaluateCommandToolApproval?: (request: ToolApprovalRequest) =>
  | Promise<{
      approved: boolean
      decision?: { kind: "allow" | "ask" | "deny"; reason: string; source: string }
      executionPlan?: CommandExecutionPlan
      hostAuthorization?: CommandHostAuthorization
      mandatorySeatbeltExecution?: boolean
    } | undefined>
  | { ... } | undefined
```

The host callback returns a full evidence payload — 5 named
fields. The SEAM09 frozen contract proposes a 9-tag closed
enum (`VerdictTag`) as the Elm projection. This is a **strict
evidence loss** (see §3 TPAEID-06 and TPAEID-08).

The other side effects in the verdict body:

- The `pendingReformulationSlot` is mutated at L461 (consume)
  and L522 (arm) — a class-field side effect that the Elm
  kernel cannot perform (see §3 TPAEID-09).
- The verdict body falls through to L686-L758 (ASK card
  publication + Promise registration) on ASK outcomes — TS-only
  per SEAM09's own recon §2.

The verdict body's load-bearing authorization is the
`{ approved: true, ... }` return at L564/L605. A wrong verdict
either denies legitimate work (false negative) or authorizes
unsafe work (false positive). The Elm cutover must guarantee
that an Elm-unavailable outcome does NOT default to a
permissive verdict (see §3 TPAEID-03).

## 2. Discriminator (the executable evidence)

**File:** `apps/vscode/src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts`

**Run:**

```text
$ cd apps/vscode && bun vitest run \
    src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts

 ✓ src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts (11 tests) 65ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
   exitCode 0
```

**Test families (per the reviewer's six required steps + four
supporting families):**

| ID | Family | What it proves | Verdict |
|---|---|---|---|
| TPAEID-01 | Synchronous-impossibility theorem | Even with a pre-warmed bundle, the Elm `Platform.worker` consult takes >= 1 event-loop tick to settle. No synchronous Elm result exists on the existing bridge. The SEAM09 "synchronous consult" claim is **unsupportable**. | CONFIRMED |
| TPAEID-02 | TOCTOU window measurement | The consult takes > 0ms wall-clock. The verdict commits at T1 > T0 (the policy-fact read time). The cutover needs an explicit snapshot/revalidate boundary. | CONFIRMED |
| TPAEID-03 | Fail-closed on `kernel_offline` | The existing bridge surfaces `kind: "kernel_offline"` (a non-directive outcome). The production caller falls through to the TS predecessor. No fabricated ALLOW. | PASS |
| TPAEID-04 | Fail-closed on `decode_error` | The existing bridge surfaces `kind: "decode_error"` for malformed directives. The production caller falls through to the TS predecessor. No fabricated ALLOW. | PASS |
| TPAEID-05 | Fail-closed on `response_timeout` | A hung kernel (sentinel invoke that never resolves) is bounded by the public-boundary timer (5 seconds in production, 50ms in the test). The bridge surfaces `kind: "decode_error"` with `reason: "no_response"`. The verdict is **never** stuck, and **never** defaults to ALLOW. | PASS |
| TPAEID-06 | Evidence conservation | The existing `evaluateCommandToolApproval` returns 5 fields (`approved`, `decision`, `executionPlan`, `hostAuthorization`, `mandatorySeatbeltExecution`). A `VerdictTag` is 1 field (`kind`). 3 of the 9 tags (`ALLOW_SDK_POLICY`, `ALLOW_HOST_CALLBACK`, `REFORMULATE`) carry an evidence-loss hazard. | CONFIRMED |
| TPAEID-07 | Migration economics — LoC | The LoC delta is not established by the discriminator; the SEAM09 frozen contract claims ~600 LoC additive. The discriminator flags this for the next ACT (or the typed-state-machine alternative). | DEFERRED |
| TPAEID-08 | Existing-await-boundary economics | At the post-L466 await, the host callback already returns full evidence. The Elm `VerdictTag` is a strict loss unless the kernel carries the full evidence payload through the wire (which contradicts the "pure projection" framing). | CONFIRMED |
| TPAEID-09 | Reformulation side-channel | The `REFORMULATE` tag is an indirect side effect via a class field (`pendingReformulationSlot` at L522 arm / L461 consume). The Elm kernel cannot perform it. The SEAM04 "kernel classifies, TS commits" pattern does not apply. | CONFIRMED |
| TPAEID-10 | Disposition harness | The disposition is recorded as `NOT_A_GOOD_ELM_SEAM` with 6 enumerated reasons (see §3). | RECORDED |
| auxiliary | Enumerate the 9 tags | The 9 VerdictTags are exactly as the SEAM09 frozen contract defines. 4 of 9 are permissive-if-defaulted. | DOCUMENTED |

### 2.1 What TPAEID-01 actually measures

The discriminator uses the **real compiled** Elm bundle
(`apps/vscode/elm/completion-continuation-control/vendor/completion-continuation-control.js`,
the same bundle the production DCB kernel uses) loaded as a
stand-in "Elm-shaped worker" via the existing
`consultDeferredCompletionBarrierElmKernel` async public
adapter. The bundle is **not a new kernel** — it is the
existing production kernel exercising the existing production
bridge. The stand-in is sufficient because the question
"is a `Platform.worker` consult synchronous?" has the same
answer regardless of which Elm kernel is compiled.

The microtask race:

```ts
const resultPromise = consultDeferredCompletionBarrierElmKernel(facts, {
  requestId: "rid-tpaeid-01",
})
await Promise.resolve() // microtask drain
const raced = await Promise.race([
  resultPromise.then(() => "settled"),
  Promise.resolve("pending"),
])
if (raced === "settled") settledSynchronously = true
expect(settledSynchronously).toBe(false) // PASS: not settled
await resultPromise // drain to avoid open handle
```

The consult settles on the **next** event-loop tick, not the
current one. This is the bridge's `setTimeout` + per-requestId
pending-map dispatch (the same pattern all 5 existing
kernels use). A synchronous Elm result is not available.

### 2.2 What TPAEID-05 actually measures

The sentinel invoke returns `new Promise<never>(() => {})` —
a hung Promise that never resolves. The public-boundary
`responseTimeoutMs: 50` (5 seconds in production) trips the
`no_response` classification. The bridge surfaces
`{ kind: "decode_error", reason: "no_response: ...", classification: "deferred_completion_barrier_elm_decode_error" }`.
The verdict is **bounded** (the test takes < 100ms) and
**fail-closed** (no `directive` is fabricated).

This is the same pattern all 5 existing kernels use; the
TPAEID-05 test confirms it works at the existing public
boundary. A 6th kernel would inherit this pattern.

## 3. Disposition: NOT_A_GOOD_ELM_SEAM (the 6 reasons)

The TPAEID-10 disposition harness records the following
result. The disposition is computed from the outcomes of
TPAEID-01 through TPAEID-09.

### 3.1 Reason 1: Platform.worker is fundamentally async

The SEAM09 frozen contract's claim of a "synchronous consult
call" is **unsupportable on the existing bridge**. Every one
of the 5 existing kernels uses the per-requestId pending-map
+ `setTimeout` + `Promise.race` pattern. A 6th kernel would
inherit the same pattern. The Elm `Platform.worker` runtime
does not have a synchronous request/response boundary (per the
official Elm guide: ports are message-exchange boundaries).
SEAM06 confirmed this; SEAM07 corrected its plan to avoid it;
SEAM09's claim is wrong.

### 3.2 Reason 2: TOCTOU window is non-zero

The verdict body at `runRequestToolApproval:427-608` is
**already** bounded by the existing await at L466. Adding an
Elm consult on the post-`await` side introduces a second
non-zero async hop. The verdict commits at T1 > T0, where T0
is the policy-fact read time and T1 is the verdict-commit
time. For a tool-approval verdict that authorizes a command,
the policy facts read at T0 must not be considered still-valid
at T1 unless the TS adapter explicitly re-validates. The
SEAM08 BCB cutover was placed at a single existing await;
this verdict body would add an await on top of an existing
await, with no corresponding "this is a fresh snapshot"
revalidation.

### 3.3 Reason 3: 3 of the 9 VerdictTags carry an evidence-loss hazard

The existing `evaluateCommandToolApproval` returns
`{ approved, decision, executionPlan, hostAuthorization,
mandatorySeatbeltExecution }`. The `decision.reason`,
`decision.source`, `executionPlan`, `hostAuthorization.mode`,
and `mandatorySeatbeltExecution` are load-bearing fields for
the production verdict body — they are read by
`runRequestToolApproval` lines 472-555 (DENY branch),
498-540 (REFORMULATE branch), 580-589 (editor ALLOW/ASK),
and 753-754 (pending record) respectively.

The SEAM09 `VerdictTag` enum discards 4 of these 5 fields
entirely. The adapter would have to:

- Re-run the host policy lattice in the adapter to
  reconstruct `decision.reason` / `decision.source` for
  ALLOW_SDK_POLICY and ALLOW_HOST_CALLBACK outcomes. The host
  policy lattice is the part of the production code that
  ALREADY makes the correct decision — moving it to the
  adapter duplicates the work and creates a new dual-authority
  hazard.
- Re-construct `executionPlan` and `hostAuthorization` from
  the adapter's own state snapshot. The adapter does not
  have access to these fields without the host callback
  running.
- Re-construct `mandatorySeatbeltExecution` for the executor
  obligation. The SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01
  precedent (line 436 of the production file) explicitly
  threads this field through the host callback for the
  executor to honor.

In short: the Elm verdict body cannot be a strict superset of
the host callback's evidence. The Elm cutover would require
either (a) the kernel carrying the full evidence payload
through the wire (which contradicts the "pure projection"
framing and increases the wire shape), or (b) the TS adapter
re-running the host policy (which duplicates the work and
creates dual authority). Neither option delivers the
correctness benefit the migration is supposed to capture.

### 3.4 Reason 4: The host callback already returns full evidence

This is the load-bearing economics argument. The
post-L466 await already returns
`{ approved, decision, executionPlan, hostAuthorization,
mandatorySeatbeltExecution }`. The TS adapter consumes this
evidence directly. The Elm cutover would add ONE more async
hop on top of this already-async call, returning a
`VerdictTag` that is strictly less informative. The
correctness benefit is the kernel "vouches for" the verdict
classification. The cost is +1 async hop + ~600 LoC of new
code + a new kernel to maintain. The benefit is bounded
because the host callback already returns the right answer;
the kernel is a redundant projection.

### 3.5 Reason 5: REFORMULATE is an indirect side effect

The `REFORMULATE` tag requires the TS adapter to mutate
`this.pendingReformulationSlot` (a class field on the
coordinator instance) at L522. The Elm kernel cannot perform
this mutation; only the TS adapter can. This breaks the
SEAM04 "kernel classifies, TS commits" pattern: the kernel
is no longer a pure projection; it is an indirect side-effect
indirector. A concurrent `runRequestToolApproval` call can
race the slot arming (the existing TOCTOU conservation pattern
at L833 / L1071 / L1227 does not cover the slot field).

The reformulation logic is a per-(agentId, conversationId)
one-shot state machine on a class field. It is **already**
TS-only by SEAM09's own recon §2. Moving it to Elm would
require the kernel to carry the slot state through the wire
on every consult, which is feasible but expensive. The
SEAM09 frozen contract's proposal of "tag payload +
post-classification mutation" is the side-channel that the
discriminator confirms.

### 3.6 Reason 6: Mirrors SEAM06

The verdict body is too small and too synchronous to justify
an Elm kernel. This is the same trap SEAM06 identified for
the 12-case `LocalRuntimeHost.runTurn` delivery decision.
The SEAM06 ACT closed with `NOT_A_GOOD_ELM_SEAM` and
recommended: "the next ACT should re-evaluate the Factory Elm
migration queue against larger semantic surfaces (e.g. the
long-horizon continuation cardinality, the held-set progress
classification, or the completion-commit stage boundary)
rather than this 12-case Boolean." The tool-approval verdict
body is similarly small (a 9-tag enum on a synchronous
projection of policy facts) and similarly expensive to cut
over (~600 LoC of new code, +1 async hop, evidence loss,
side-channel reformulation).

The recommended next candidate (per the SEAM06 and SEAM10
disposition): the next ACT should re-evaluate the Factory Elm
migration queue against larger semantic surfaces. Possible
candidates:

- The per-tool `pendingToolApprovalResolve` slot lifecycle
  (the Promise-resolver state machine at L1067-L1103 + the
  cleanup at L930-L931 + the `clearPending` semantic at
  L1102) — but this is necessarily TS-only because the
  user IS the answer source. The Elm "consult" model is
  incompatible with the destructive single-slot Promise
  machine.
- The full `evaluateCommandToolApproval` host callback (the
  canonical command-policy lattice in
  `sdk/packages/core/src/runtime/command-policy/`) — but
  this is in the SDK, not the VSCode adapter, and the
  SEAM06 finding of "the SDK must stay clean of VSCode
  assets" applies directly. The Elm cutover would need to
  ship the kernel as a SDK runtime asset, which conflicts
  with the existing 5-kernel VSCode-only convention.
- The next Factory Elm-migration candidate should be one
  where the existing await boundary is the natural cutover
  point AND the projection is bounded enough to be a
  stable Elm model AND the evidence payload can be carried
  through the wire without loss AND the migration is
  motivated by a specific correctness benefit (not a
  "this is policy, Elm is good at policy" generalization).

## 4. Verdict

**`NOT_A_GOOD_ELM_SEAM`.**

The discriminator was executed against the SEAM09 frozen
contract. The disposition harness (TPAEID-10) returns
`NOT_A_GOOD_ELM_SEAM` with 6 enumerated reasons (§3.1-3.6).
The SEAM10 production cutover is **not authorized**.

**Production delta: ZERO.** The production TS expression
remains the live authority unchanged. No Elm kernel written.
No TS adapter added. No host callback introduced. No probe
code point added. The 6th Elm kernel position in the
`_ELM_KERNELS` array of `scripts/build_dogfood_vsix_lib.py`
remains unallocated.

**What this ACT proves vs. what is still out of scope:**

| Boundary | Status | Evidence |
|---|---|---|
| Real Elm bridge is fundamentally async | PROVEN | TPAEID-01 |
| TOCTOU window is non-zero | PROVEN | TPAEID-02 |
| Existing bridge is fail-closed on `kernel_offline` | PROVEN | TPAEID-03 |
| Existing bridge is fail-closed on `decode_error` | PROVEN | TPAEID-04 |
| Existing bridge is fail-closed on `response_timeout` | PROVEN | TPAEID-05 |
| 3 of 9 VerdictTags have evidence-loss hazard | PROVEN | TPAEID-06 |
| LoC delta measurement | NOT_PROVEN | TPAEID-07 (deferred to next ACT) |
| Post-L466 host callback returns full evidence | PROVEN | TPAEID-08 |
| REFORMULATE is an indirect side effect | PROVEN | TPAEID-09 |
| Disposition is one of the three allowed | PROVEN | TPAEID-10 |
| Typed-state-machine TS alternative LoC | NOT_PROVEN | (out of scope; possible next ACT) |
| SEAM04 pattern applicability to this seam | DISPROVEN | TPAEID-09 |
| `commandEval` evidence payload lossless round-trip via `VerdictTag` | DISPROVEN | TPAEID-06 + TPAEID-08 |

## 5. Files

**New (3):**
- `apps/vscode/src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts` (the discriminator; 11 tests; 60+ lines)
- `.factory/ACT-CLINEMM-ELM-SEAM10-INTEROP-DISC.md` (this ACT plan)
- `.factory/acts/ACT-CLINEMM-ELM-SEAM10-INTEROP-DISC.md` (canonical ACT plan, identical per SEAM07 convention)

**Updated (1):**
- `.factory/epic-board.md` (entry appended)

**Production code changes: ZERO.** The discriminator is a
test-only addition. It uses the existing
`consultDeferredCompletionBarrierElmKernel` async public
adapter and the real compiled `completion-continuation-control`
kernel bundle as a stand-in. No new Elm kernel written; no
new TS adapter added; no host callback introduced; no probe
code point added; no `scripts/build_dogfood_vsix_lib.py` row.

## 6. Evidence

```text
$ cd apps/vscode && bun vitest run \
    src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts

 ✓ src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts (11 tests) 65ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
   exitCode 0
```

```text
$ cd apps/vscode && bun vitest run \
    src/sdk/sdk-interaction-coordinator.test.ts \
    src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts \
    src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts

 ✓ src/sdk/__tests__/tool-approval-authority-elm-interop-discriminator.tpaeid01.test.ts (11 tests) 62ms
 ✓ src/sdk/sdk-interaction-coordinator.test.ts (43 tests) 1216ms
 ✓ src/sdk/__tests__/approval-rejection-correlation-fail-closed-recon01.test.ts (6 tests) 593ms
 Test Files  3 passed (3)
      Tests  60 passed (60)
   exitCode 0
```

```text
$ cd apps/vscode && bun --bun tsc --noEmit

exitCode=0
0 errors
```

## 7. Gates

- `git status --short` → empty before this ACT's commit.
- `git diff --check` → exit 0.
- ENTRY_HEAD = `ff80cddbf92a4e9b834fe75359d17e64a687949b`
  (the SEAM09 commit).
- No production code touched.
- SEAM01–09 evidence preserved in `.factory/epic-board.md`
  and the per-ACT files in `.factory/`.
- HALT_UNEXPECTED_TRACKED_DIRT: NOT TRIGGERED.
- The reviewer's C1 verdict (GO to discriminator; NO-GO for
  immediate cutover) is honored in full.

## 8. Predecessor ACT lineage

- `ACT-CLINEMM-ELM-SEAM09-TOOL-APPROVAL-LIFECYCLE-RECON`
  (`PASS_ELM_SEAM09_RECON`) — the recon that selected the
  production seam. Its frozen contract (9-tag closed enum
  `VerdictTag`) is the target of this discriminator. The
  recon's "synchronous consult call" claim is the load-bearing
  unsupportable assumption that the discriminator
  disproves.
- `ACT-CLINEMM-ELM-SEAM07-CORRECTION01-SYNCHRONY-AND-FAILURE-FALLBACK`
  (`PASS_ELM_SEAM07_CORRECTION01`) — the correction that
  established the SEAM08 cutover at the existing await
  boundary, NOT a new one. The reviewer's P0 synchrony
  correction is the same correction this discriminator
  applies to the SEAM09 frozen contract.
- `ACT-CLINEMM-ELM-SEAM06-PROMPT-ADMISSION-CUTOVER`
  (`NOT_A_GOOD_ELM_SEAM`) — the prior verdict of the same
  shape. The SEAM06 12-case delivery decision and the
  SEAM10 9-tag policy decision both fall into the
  "small synchronous projection + new async hop + ~600 LoC
  Elm cost ⇒ cutover is not worth it" trap.
- `ACT-CLINEMM-APPROVAL-REJECTION-CORRELATION-FAIL-CLOSED-RECON01`
  (`CORRELATION_DEFECT_NOT_REPRODUCED`) — the recon
  witness for the tool-approval lifecycle. The 6/6 GREEN
  on R1–R6 is the load-bearing execution-path evidence
  that the SEAM09 sub-seam is real. The TPAEID01
  discriminator builds on this evidence: the real
  production entrypoint at
  `sdk-interaction-coordinator.ts:427-608` is the same
  entrypoint the SEAM09 recon exercised.

## 9. Next cursor

This ACT does not authorize a successor implementation ACT.
The next ACT (if any) should be a recon ACT for a
**different** candidate, NOT the tool-approval verdict body.
Possible next candidates, in priority order:

1. **The full `evaluateCommandToolApproval` host callback.**
   This is the canonical command-policy lattice in
   `sdk/packages/core/src/runtime/command-policy/`. It is
   larger than the SEAM09 sub-seam (multiple stages of
   path-authority, realpath, seatbelt-envelope, and
   host-mode-safety checks). However, it lives in the SDK
   not the VSCode adapter, and the SEAM06 finding of
   "the SDK must stay clean of VSCode assets" applies
   directly. The Elm cutover would need to ship the
   kernel as a SDK runtime asset, which conflicts with
   the existing 5-kernel VSCode-only convention. A
   dedicated recon ACT would need to scope this carefully.

2. **The `pendingToolApprovalResolve` slot lifecycle.** The
   Promise-resolver state machine at L1067-L1103 + the
   cleanup at L930-L931 + the `clearPending` semantic at
   L1102. This is necessarily TS-only because the user
   IS the answer source — the Elm "consult" model is
   incompatible with the destructive single-slot Promise
   machine. The SEAM09 recon already concluded this; the
   next ACT should not re-litigate it.

3. **A different production decision authority entirely.**
   The next ACT should re-evaluate the Factory Elm
   migration queue against a candidate where:
   (a) the existing await boundary is the natural cutover
   point,
   (b) the projection is bounded enough to be a stable
   Elm model,
   (c) the evidence payload can be carried through the
   wire without loss,
   (d) the migration is motivated by a specific correctness
   benefit (not a "this is policy, Elm is good at policy"
   generalization).

The 6th Elm kernel position in the
`_ELM_KERNELS` array of `scripts/build_dogfood_vsix_lib.py`
remains unallocated. No build pipeline change is needed
for this ACT.

## 10. Factory stop rule

- **HALT_P0_TRIGGERED:** None. The P0 synchrony correction
  and P1 evidence-loss and side-channel findings are
  addressed by the `NOT_A_GOOD_ELM_SEAM` verdict. No
  production code was at risk; the verdict body remains
  TS-owned.
- **HALT_P1_TRIGGERED:** None.
- **No recursive Factory review initiated.** This ACT
  executes the SEAM10 discriminator (the reviewer's
  explicit obligation); the verdict is `NOT_A_GOOD_ELM_SEAM`
  and the next ACT is a recon for a different candidate
  (per §9), not a retry of this candidate.
