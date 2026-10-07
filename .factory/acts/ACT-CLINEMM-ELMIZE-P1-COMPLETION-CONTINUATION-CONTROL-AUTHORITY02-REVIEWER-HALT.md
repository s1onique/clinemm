# ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02 — REVIEWER HALT

**Status:** HALT. The proposed `PASS_COMPLETION_CONTINUATION_ELM_CONTROL_AUTHORITY`
closure is REJECTED on two independent P0 grounds plus a P1 hygiene defect.
**The ACT is NOT closed.** The submitted patch must NOT be merged in this form.

Subject HEAD under review: `7e685a5d6ccab90531d047543b8643c1e0132f2d`
(staged: 29 A, 2 M; ACT document itself `??` untracked).

Reviewer: ClineMM Factory reviewer + AI-SDK transport engineer + Elm/TS interop engineer.
Reviewer feed: 2026-10-07 LIVE screenshot + digest of the staged patch.

---

## Verdict

```text
HALT_MODEL_PRIVILEGE_TRANSPORT_INVALID          (P0 — LIVE)
HALT_ELM_CONTROL_AUTHORITY_NOT_PRODUCTION_WIRED (P0 — documentary / structural)
HALT_ELM_COMPILER_VENDORED_BINARY_STAGED       (P1 — hygiene / build architecture)
```

The current staged changeset makes one LIVE bug worse (the continuation is now
structurally privileged but reaches the model via an invalid transport) and
one documentary bug worse (it claims a production cutover the inner patch does
not contain). Both are non-negotiable.

---

## P0 #1 — `role: "system"` message in the AI SDK prompt is invalid for v6

### LIVE evidence (decisive)

The continuation reaches the model as:

```text
Invalid prompt:
System messages are not allowed in the prompt or messages fields.
Use the instructions option instead.
```

The task header immediately after the continuation reads **Error**.

### Root cause

`ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION02-MODEL-PRIVILEGE`
(introduced in commit `a660d29ff`) promoted the runtime-origin continuation to
the `role: "system"` *message* channel. `CORRECTION03` (commit `050686d9b`) and
`CORRECTION04` (commit `6e384d484`) hardened the brand so the role could not
be forged by user/tool input. All three are correct about *who* can claim the
privileged role, but they chose the wrong *provider-facing representation*.

AI SDK v6 (current `@ai-sdk` version in this repo) explicitly rejects
`role: "system"` inside `prompt` / `messages` unless the compatibility flag
is opted in. The intended privileged channel is the top-level `instructions`
option of `generateText` / `streamText`.

### Why `allowSystemInMessages: true` is not the fix

Enabling that flag would tell the SDK to accept the very representation the
SDK considers injection-sensitive. It papers over the wrong-transport choice
without changing the underlying posture. The fix is to *use the SDK's intended
privileged instruction channel*.

### Required target architecture

```text
host private provenance   (CORRECTION01–04 retained)
        ↓
runtime completion control (pure directive policy — Elm substrate GREEN)
        ↓
provider request assembly
        ├── ordinary transcript     →  messages
        └── trusted continuation   →  instructions
```

User / tool content MUST remain unable to populate the privileged instruction
slot. The trust identity (`WeakSet` brand, `markHostRuntimeControl` /
`isHostRuntimeControlMessage`) is retained as the gate; only the wire-format
representation of the privileged slot changes.

### Concretely, the producer-side seam must change

`LocalRuntimeHost.executeAgentTurn` (sdk/packages/core/src/runtime/host/local-runtime-host.ts:2336)
still attaches `role: "system"` to the `AgentMessage` envelope:

```text
sdk/packages/core/src/runtime/host/local-runtime-host.ts:2415    role: "system",
```

…and `SessionRuntime.executeRunInternal`
(sdk/packages/core/src/runtime/orchestration/session-runtime-orchestrator.ts:945)
promotes on `isHostRuntimeControlMessage(rawMessage)` into that role. The
brand/identity path is correct; the projection at the AI-SDK boundary is what
is invalid. The CORRECTION05 producer must:

1. Keep the brand-validated gate (`isHostRuntimeControlMessage`).
2. Stop emitting a `role: "system"` `AgentMessage` entry.
3. Emit the privileged continuation as the top-level `instructions` argument
   on the `generateText` / `streamText` call that the SDK makes.
4. Keep the untrusted transcript (user / assistant / tool) on `messages`.

The user-supplied envelope path stays `role: "user"` and goes through
`messages`. The brand-authenticated path goes through `instructions`.

### Suggested successor ACT

```text
ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION05-INSTRUCTIONS-TRANSPORT
```

Scope: a single bounded repair ACT. Same predecessor gate green check
(`CCSA01`, `CCPB01`, `CCPB01-FORGE-01`), plus a RED/GREEN at the AI-SDK
boundary asserting the privileged continuation reaches the model via
`instructions` and the user-origin cannot reach that slot. RED must show
the current patch breaks the LIVE run before this correction lands.

---

## P0 #2 — the Elm cutover claim is contradicted by the patch

### The claim (digest, §"TS_POLICY_PRODUCTION_CALLERS (C34)"):

```text
production callers of buildCompletionContinuationControl  = 0  (test-only)
production callers of completeContinuationControlFromSession = 0 (test-only)
Elm directive policy production callers                   = 1  (pickContinuationDirectiveForPublication)
```

### What the patch actually contains (grep, 2026-10-07)

`pickContinuationDirectiveForPublication` is defined exactly once in the
repo, in the adapter:

```text
apps/vscode/src/sdk/completion-continuation-control-elm.ts:625
  export async function pickContinuationDirectiveForPublication(
```

It has **zero production callers**. Every reference is in `__tests__/`:

```text
apps/vscode/src/sdk/__tests__/completion-continuation-control-elm-authority-cutover.ccac01.test.ts
apps/vscode/src/sdk/__tests__/completion-continuation-control-elm-capability.cccap01.test.ts
apps/vscode/src/sdk/__tests__/completion-continuation-control-elm-conservation.cccs01.test.ts
apps/vscode/src/sdk/__tests__/completion-continuation-control-elm-correspondence.cccec01.test.ts
apps/vscode/src/sdk/__tests__/completion-continuation-control-elm-loader-discriminator.ccld01.test.ts
apps/vscode/src/sdk/__tests__/completion-continuation-control-elm-malformed.ccmb01.test.ts
apps/vscode/src/sdk/__tests__/completion-continuation-control-elm-namespace-coexistence.ccnc01.test.ts
```

The actual production continuation-decision seam is unchanged:

```text
apps/vscode/src/sdk/background-notify-coordinator.ts:501-544   buildCompletionContinuationControl
apps/vscode/src/sdk/background-notify-coordinator.ts:552-578   completeContinuationControlFromSession
apps/vscode/src/sdk/background-notify-coordinator.ts:604-671   parseCompletionContinuationControl
apps/vscode/src/sdk/background-notify-coordinator.ts:274-383   formatCompletionContinuationPrompt
```

These four functions remain TS, still pure, still the live policy. The Elm
adapter sits beside them unused.

### Why the ablation test does not rescue the claim

The `ccac01` cutover test calls `pickContinuationDirectiveForPublication`
*directly* with a `invokeElmForProduction` override and asserts the override
controls the result. That proves:

```text
WHEN the adapter is invoked by the test
THEN the adapter obeys Elm.
```

It does NOT prove:

```text
WHEN the actual continuation path needs a directive
THEN the actual continuation path calls the adapter.
```

That is exactly the Factory failure mode the reviewer flagged:

```text
test-only authority
presented as
production authority
```

### Capability binding has the same weakness

`completion-continuation-control-elm-capability.cccap01.test.ts` claims to
exercise the "actual resumed-turn tool registry" via
`factsFromRegistry(["command_status", "submit_and_exit"])` and derives
`.includes(...)` from a literal array — which is the test's own array, not
the resumed request's tool registry. It is a useful matrix, but it is not
evidence that production facts come from the real registry. The previous
ACT reviewer's P1 (capability-binding evidence gap) is still open.

### Reclassification of the substrate

The Elm implementation is correct as a *policy substrate*. It must be
reclassified:

```text
WAS:  PASS_COMPLETION_CONTINUATION_ELM_CONTROL_AUTHORITY (closure claim)
NOW:  PASS_COMPLETION_CONTINUATION_ELM_POLICY_SUBSTRATE (no authority claim)
```

### Required successor ACT — REAL production cutover

```text
ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06-ELM-PRODUCTION-WIRING
```

Must contain, on the same machine, against the same tree:

1. Modify `background-notify-coordinator.ts:buildCompletionContinuationControl`
   (and / or `completeContinuationControlFromSession`, depending on which
   the ACT scopes) so the production directive path actually calls
   `pickContinuationDirectiveForPublication` (the Elm adapter). The change
   must be at the live seam, not at a parallel test seam.
2. Add a RED test that, given an ablated Elm kernel returning a sentinel
   failure directive, the *actual continuation path* emits the sentinel.
   This is the load-bearing proof: it can only go RED if the production
   caller changed.
3. Re-prove the LIVE run after #1 and the A-theory fix land together
   (because the current LIVE bug is what unmasked the production cutover
   absence — the continuation errored before any policy decision was needed,
   which is why nobody noticed the adapter wasn't on the live path).

The same successor ACT (or a tightly coupled one) must repair the AI-SDK
transport (P0 #1). Otherwise the LIVE run still errors immediately after the
continuation.

The recommended shape is one ACT with two tightly related boundaries:

```text
ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION05-INSTRUCTIONS-TRANSPORT
   (1) fix the privileged continuation's provider representation
       role:"system" message  →  instructions option

ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06-ELM-PRODUCTION-WIRING
   (2) wire the Elm directive into the actual production continuation
       decision seam; RED proving the actual production caller changed
       when Elm output is ablated
```

Both must land together with the LIVE run green. The substrate-only ACT
(this one) is reclassified GREEN (no authority claim) so the Elm work is
not lost.

---

## P1 — vendored Elm compiler binary is staged as a new 60 MB blob

`apps/vscode/elm/completion-continuation-control/vendor/elm` is `59,968,512`
bytes (verified by `wc -c`). It is staged as a new binary under
`completion-continuation-control/`, which means:

```text
- a second 60 MB Elm compiler lands in the tree
- while an older copy lives elsewhere (the TaskHeader kernel in
  apps/vscode/elm/task-header-orchestration/vendor/elm is one prior instance)
- the kernel-resolver/centralization ACT (per the prior reviewer rubric) is
  deferred to "subsequent" — meaning the duplication is being baked in now
```

### Required cleanup before this ACT ships

Remove `apps/vscode/elm/completion-continuation-control/vendor/elm` from the
staged set, alongside the existing `.sha256` and `.version` files. Fold the
new kernel's path resolution into a shared compiler resolver as a SEPARATE
small ACT (the toolchain-centralization ACT the prior reviewer said was
"subsequent"). The new kernel must consume the same compiler binary the
older kernels do, not carry its own 60 MB copy.

### Why now (not "fold into a later cleanup")

The closure document is untracked, the ACT is not actually closed, and the
worktree is dirty. This is the ideal moment — a clean integration point —
to remove the duplication. Bundling it into "later" would freeze the
duplication into a fresh kernel and require a follow-up cleanup ACT
specifically to retract a binary.

---

## And the ACT isn't closed anyway

The closure document `.factory/acts/ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02.md`
is untracked:

```text
$ git status --short
A  apps/vscode/elm/... (29 staged)
M  apps/vscode/src/extension.ts
M  scripts/build_dogfood_vsix_lib.py
?? .factory/acts/ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02.md
```

The digest claims `Status: CLOSED` in an untracked document. A CLAIM in
an untracked document does not close an ACT — the closure must keep the
document inside the same commit graph as the code it claims to close.
Cline's branch protection should have flagged this earlier; the reviewer
feed caught it.

### What to do with the closure document

- Reject its current content (it claims authority the patch does not
  contain).
- Re-issue under the corrected verdict:
  `PASS_COMPLETION_CONTINUATION_ELM_POLICY_SUBSTRATE` (substrate GREEN,
  authority cutover NOT PROVEN) — once the P1 binary cleanup lands.
- Stage it together with the code it describes, not as a separate untracked
  document.

---

## What MUST happen before this ACT can close

1. **Do not commit the current patch.** The Elm implementation is retained
   as substrate, but the authority cutover claim is retracted.
2. **Open CORRECTION05** (AI-SDK transport: `role: "system"` message →
   `instructions` option) with a single bounded producer-side seam change
   and a RED/GREEN at the AI-SDK boundary.
3. **Open CORRECTION06** (Elm production wiring): modify
   `background-notify-coordinator.ts:buildCompletionContinuationControl` to
   call `pickContinuationDirectiveForPublication`; add an ablation RED that
   fails unless the production caller is wired.
4. **Remove the vendored `elm` binary** from this staged patch; centralize
   the compiler resolver in a separate toolchain ACT.
5. **Re-stage the closure document** under the corrected verdict
   (`PASS_COMPLETION_CONTINUATION_ELM_POLICY_SUBSTRATE`) together with the
   code it describes.

### What is kept (do not discard)

```text
apps/vscode/elm/completion-continuation-control/
    elm.json
    scripts/build-elm.sh
    scripts/test-elm.sh
    src/Policy.elm
    src/Domain.elm
    src/Codec.elm
    src/Main.elm
    tests/CompletionContinuationControlTest.elm
    vendor/.gitkeep                 (kept; binary removed)
apps/vscode/src/sdk/completion-continuation-control-elm.ts   (adapter retained)
apps/vscode/src/sdk/__tests__/completion-continuation-control-elm-*.test.ts (tests retained)
apps/vscode/elm/completion-continuation-control/.gitignore   (kept)
scripts/build_dogfood_vsix_lib.py    (kernel table row retained; path stage contract retained)
apps/vscode/src/extension.ts         (kernel path setup retained)
sdk/packages/core/src/runtime/turn-queue/host-runtime-control-brand.ts (CORRECTION04 brand kept)
```

### What is removed from this patch

```text
apps/vscode/elm/completion-continuation-control/vendor/elm
apps/vscode/elm/completion-continuation-control/vendor/elm.sha256
apps/vscode/elm/completion-continuation-control/vendor/elm.version
.factory/acts/ACT-CLINEMM-ELMIZE-P1-COMPLETION-CONTINUATION-CONTROL-AUTHORITY02.md  (re-issued under corrected verdict)
```

---

## Board update (machine-readable)

```yaml
control_authority_transport:
  status: HALT_MODEL_PRIVILEGE_TRANSPORT_INVALID   # P0 LIVE
  evidence: AI-SDK v6 rejects role:"system" in messages; runtime-origin continuation must travel via top-level instructions option
  remediation: ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION05-INSTRUCTIONS-TRANSPORT

elm_continuation_policy:
  status: SUBSTRATE_GREEN_AUTHORITY_NOT_PROVEN       # reclassified
  evidence: pickContinuationDirectiveForPublication has zero production callers; buildCompletionContinuationControl remains the live policy; ablation test only proves test-side adapter obedience
  remediation: ACT-CLINEMM-P0-COMPLETION-CONTINUATION-CONTROL-AUTHORITY01-CORRECTION06-ELM-PRODUCTION-WIRING

elm_compiler_duplication:
  status: HALT_ELM_COMPILER_VENDORED_BINARY_STAGED  # P1
  evidence: 59,968,512 bytes vendored; older kernels already present; resolver centralization deferred
  remediation: remove vendored binary from this patch; centralize resolver in separate toolchain ACT
```

---

## Why this reviewer halt is structural, not just documentary

The proposed closure made the same kind of structural error that the prior
CONTROL_AUTHORITY01 ACT cycle caught and corrected:

| ACT | Failure | Reviewer halt |
|---|---|---|
| CONTROL_AUTHORITY01 (initial) | structural provenance was textual metadata | HALT_CONTROL_AUTHORITY_STILL_LEXICAL |
| CONTROL_AUTHORITY01-CORRECTION01 | metadata discriminator | HALT_CONTROL_AUTHORITY_METADATA_NOT_PRIVILEGED |
| CONTROL_AUTHORITY01-CORRECTION02 | metadata-only authentication | HALT_RUNTIME_CONTROL_BRAND_FORGEABLE (caught in CORRECTION03) |
| CONTROL_AUTHORITY01-CORRECTION03 | Symbol.for(…) registry brand | HALT_RUNTIME_CONTROL_BRAND_FORGEABLE |
| CONTROL_AUTHORITY01-CORRECTION04 | private WeakSet brand | ✅ brand OK, transport FIX |
| **ELMIZE-P1-CONTROL-AUTHORITY02** | **claim of production cutover that is not in the diff; privileged role chosen on the wrong provider channel** | **HALT_MODEL_PRIVILEGE_TRANSPORT_INVALID + HALT_ELM_CONTROL_AUTHORITY_NOT_PRODUCTION_WIRED** |

The pattern is consistent: each cycle fixes the prior halt but introduces a
new structural gap on the next axis (who → what → where → transport →
wiring). The next two ACTs (CORRECTION05 transport + CORRECTION06 wiring)
are the natural next pair on that axis and the substrate this ACT proves is
the right substrate to land them on.
