# ACT-CLINEMM-ELM-SEAM06-PROMPT-ADMISSION-CUTOVER — NOT_A_GOOD_ELM_SEAM — 2026-10-09

**Status:** CLOSED with verdict `NOT_A_GOOD_ELM_SEAM`. A bounded
production cutover was attempted at the SEAM05-selected decision
seam (`LocalRuntimeHost.runTurn` lines 1244–1274), but the
migration cost exceeds the correctness benefit. No production
code touched. No Elm kernel written.

This is a legitimate exit. Per the SEAM05 reviewer's findings
table and the C11 economics directive:

> If the implementation requires a generic message bus,
> asynchronous queue, or substantial infrastructure for a
> twelve-case truth table: `NOT_A_GOOD_ELM_SEAM`.

The seam is too small and too synchronous to justify an Elm
kernel.

## 1. Preconditions

- ENTRY_HEAD = `3eb40c5f8ed73e890452512e001b5af55daec9ff` on
  branch `main`; working tree clean; no stashes; no uncommitted
  changes.
- `git status --short` returns empty.
- `git diff --check` exits 0.
- SEAM05 evidence preserved in
  `.factory/ACT-CLINEMM-ELM-SEAM05-PROMPT-ADMISSION-RECON.md`
  and `.factory/epic-board.md`.
- HALT_UNEXPECTED_TRACKED_DIRT: NOT TRIGGERED.

## 2. Production seam (frozen by SEAM05)

`LocalRuntimeHost.runTurn` at
`sdk/packages/core/src/runtime/host/local-runtime-host.ts:1227–1274`.

```ts
async runTurn(input: SendSessionInput): Promise<AgentResult | undefined> {
    const session = this.getSessionOrThrow(input.sessionId);
    const canStartRun = session.agent.canStartRun();
    const resolvedDelivery =
        input.delivery ??
        (session.interactive && !canStartRun ? ("queue" as const) : undefined);
    const delivery = resolvedDelivery;
    // ... telemetry ...
    if (delivery === "queue" || delivery === "steer") {
        this.pendingPromptsController.enqueue(input.sessionId, { ... });
        return undefined;
    }
    // ... executeTurn(...)
}
```

The entire current policy is one line:

```ts
input.delivery ?? (session.interactive && !canStartRun ? "queue" : undefined)
```

12 input combinations → 3 outputs (queue / steer / immediate).

## 3. C0 — Implementation recon (summary)

| Field | Value |
| --- | --- |
| `SDK_COMPOSITION_SEAM` | `sdk/packages/core/src/runtime/host/host.ts:createLocalRuntimeHost` → `new LocalRuntimeHost({...})` |
| `AUTHORITY_CALLBACK_SEAM` | NEW `LocalRuntimeHostOptions.promptAdmissionAuthority?: (facts) => AdmissionDelivery` (illustrative; not added) |
| `ELM_RUNTIME_LOCATION` | `apps/vscode/elm/prompt-admission-authority/` (mirrors the four existing kernels at `apps/vscode/elm/{completion-authority, completion-continuation-control, task-header-orchestration, background-notify-authority}/`) |
| `SYNCHRONOUS_CALL_CONTRACT` | **FAILED — `Platform.worker` is fundamentally asynchronous** |
| `SDK_NON_VSCODE_CONSUMERS` | `sdk/packages/core/src/hub/daemon/runtime-handlers.ts`, `sdk/packages/core/src/hub/server/hub-server-transport.ts`, test rigs in `sdk/packages/core/src/runtime/host/local-runtime-host.test.ts` and many `apps/vscode/src/sdk/__tests__/*` bridges. None of them currently construct the host with VS Code Elm kernels. The SDK must stay clean of VS Code assets. |

### Key recon findings

1. **`LocalRuntimeHost` is constructed in two places**:
   - `sdk/packages/core/src/runtime/host/host.ts:createLocalRuntimeHost` —
     the SDK composition seam used by `ClineCore.create` and the
     hub/daemon entries.
   - Direct construction in test files (e.g.
     `local-runtime-host.test.ts:4861`) using
     `new RuntimeHostUnderTest({...})`.
   - The existing `pendingPromptCapture` option is the precedent
     for the kind of narrow injection this cutover would need.

2. **The SDK must NOT depend on `apps/vscode/`.** A `grep -rn
   "from .@/"` across `sdk/packages/core/src` returns no
   application-side imports; the only matches are text comments
   inside source files. This is a load-bearing boundary.

3. **All four existing Elm kernels use `Platform.worker`.**
   Verified:
   - `apps/vscode/elm/background-notify-authority/src/Main.elm`
   - `apps/vscode/elm/completion-authority/src/Main.elm`
   - `apps/vscode/elm/completion-continuation-control/src/Main.elm`
   - `apps/vscode/elm/task-header-orchestration/src/Main.elm`
   - The compiled `background-notify-authority.js` shows
     `outbound` registered via `_Platform_outgoingPort` and
     `inbound` via `_Platform_incomingPort`. The update function
     is wrapped in `_Scheduler_binding` (a microtask), so the
     Elm response is dispatched asynchronously through the Elm
     scheduler.
   - The corresponding TS adapter
     (`apps/vscode/src/sdk/background-notify-authority-elm.ts:700`)
     is `async function invokeElmForConsumeDecision(...)` and
     returns a `Promise<BackgroundNotifyAuthorityElmAudit>`.

## 4. C2 — Synchronous interop discriminator

The production seam currently performs the decision
**synchronously** between `canStartRun()` observation and the
enqueue / `executeTurn` effect. There is no `await` between
these two steps. Adding an `await` would change the runtime
semantics in a way that is NOT safe:

1. **Concurrent call race.** Two `runTurn` calls arriving in
   the same JavaScript turn could interleave their `await`
   resolutions. The SEAM04 review specifically halted a prior
   attempt (`HALT_HELD_SET_PROGRESS_AUTHORITY_UNSAFE`) for
   exactly this reason: an `await` between preliminary state
   inspection and the dedupe guard introduced a concurrent-call
   race.
2. **Telemetry ordering.** The `session.input_sent` capture at
   line 1249 is observed BEFORE the effect. An `await` here
   would break the temporal ordering the production code
   documents at lines 1276–1287.
3. **The Elm kernel is not synchronous.** `Platform.worker`
   port dispatch is mediated by `_Scheduler_binding`, which
   routes through a microtask. Even a "send and read" loop
   cannot complete a single round-trip synchronously without
   reaching into private scheduler functions — which is
   explicitly forbidden by the C2 directive.

**Result:** `OBSERVED_ASYNCHRONOUS`. The seam cannot be safely
migrated to Elm without either:

- (a) Adding an `await` between `canStartRun()` and the
  enqueue / execute effect, which introduces a concurrent-call
  race (per SEAM04 P0 #2) and changes telemetry ordering; OR
- (b) Reaching into Elm's private scheduler, which is
  forbidden.

Neither path is acceptable for a 1-line Boolean expression.

## 5. C11 — Migration economics

The policy under migration is:

```ts
input.delivery ?? (session.interactive && !canStartRun ? "queue" : undefined)
```

— one line, 12 input combinations, no IO, no async, no
shared state, no allocation.

The minimum Elm replacement (per the SEAM05 P1 corrections)
would require:

| Component | Approx size |
| --- | --- |
| `Domain.elm` (types + factsIsExpected) | ~50 lines |
| `Policy.elm` (12-case decision) | ~25 lines |
| `Codec.elm` (closed-schema decoder/encoder) | ~150 lines |
| `Main.elm` (Platform.worker + ports) | ~120 lines |
| `tests/PromptAdmissionAuthorityTest.elm` | ~80 lines |
| `scripts/build-elm.sh` | ~80 lines |
| `scripts/test-elm.sh` | ~30 lines |
| `apps/vscode/src/sdk/prompt-admission-authority-elm.ts` (TS adapter) | ~300 lines |
| Production-host correspondence test (C1) | ~250 lines |
| 12-case Elm ↔ TS correspondence test | ~150 lines |
| Failure-mode tests (kernel-offline, decode-error, no-response) | ~200 lines |
| `_ELM_KERNELS` table extension in `build_dogfood_vsix_lib.py` | ~10 lines |
| `LocalRuntimeHostOptions.promptAdmissionAuthority` plumbing in `local-runtime-host.ts` | ~15 lines |
| `vscode-session-host.ts` adapter wiring | ~5 lines |

**Total: ~1,500 lines of new code, four new files, one new
production seam, three new failure modes, and one new async
boundary** for a one-line synchronous Boolean expression. This
is the textbook "substantial infrastructure for a twelve-case
truth table" the C11 directive explicitly forbids.

Additionally, the P1-B SEAM05 correction (universal `immediate`
fallback is unsafe) requires the Elm kernel to either (a) be
treated as advisory with a separate TS emergency fallback
(which means Elm is NOT the authority), or (b) refuse the
admission when the kernel is unavailable (which means prompt
loss unless carefully bounded). Either way, the migration
introduces a NEW failure mode that did not previously exist,
in a place where zero failure modes currently exist.

## 6. The four Elm kernel precedents confirm the cost

Comparing to the four kernels already shipped:

| Kernel | LOC (Elm) | LOC (TS adapter) | Failure modes | Cutovery ACT |
| --- | --- | --- | --- | --- |
| `completion-authority` | ~350 | ~700 | 5 | SEAM01 |
| `task-header-orchestration` | ~250 | ~600 | 4 | SEAM02 |
| `completion-continuation-control` | ~280 | ~700 | 6 | (in flight) |
| `background-notify-authority` | ~300 | ~800 | 5 | SEAM04 |

Each of these kernels had a substantial semantic surface
(5–6 outcomes, precedence rules, validation constraints) that
justified the migration. The prompt-admission decision is a
single Boolean expression with three outcomes — a 10–20× size
mismatch.

## 7. SEAM05 reviewer's verdict (the load-bearing instruction)

> **Reviewer findings table** (excerpted from
> `.factory/ACT-CLINEMM-ELM-SEAM05-PROMPT-ADMISSION-RECON.md`):
>
> | Finding | Severity | Action |
> | --- | --- | --- |
> | Real production funnel identified | PASS | Preserve |
> | Closed three-tag decision vocabulary | PASS | Preserve |
> | Test-local baseline, not production correspondence | P1 | Add real-seam proof in SEAM06 |
> | Universal `immediate` fallback | P1 | Replace before cutover |
> | SDK→VS Code dependency risk | P1 | Resolve at composition boundary |
>
> **Migration-economics watch** (excerpted):
>
> > The entire current policy is: [...]
> > 12 input combinations. The Elm replacement could easily
> > introduce more complexity (loading, serialization,
> > correlation, failures, deployment) than it removes.
> > SEAM06 must require:
> > - a small adapter with no generic RPC framework,
> > - no asynchronous admission race,
> > - no duplicated canonical session state.
> >
> > If the clean boundary proves expensive, record
> > `NOT_A_GOOD_ELM_SEAM` and select the next candidate
> > rather than forcing the migration.

All three SEAM05 requirements collide with the seam's
inherent shape:

- "small adapter with no generic RPC framework" — the
  minimum adapter is still ~300 lines of port-correlation
  code, request-ID management, and a Promise-based loader.
- "no asynchronous admission race" — the Elm kernel is
  fundamentally async; an `await` introduces a race.
- "no duplicated canonical session state" — the policy
  reads `canStartRun()` once at request time; an Elm
  adapter would re-snapshot it through JSON
  serialization.

## 8. Verdict

**`NOT_A_GOOD_ELM_SEAM`.**

The migration cost exceeds the correctness benefit for a
1-line, 12-case, synchronous Boolean policy. No production
code touched. No Elm kernel written. The production TS
expression remains the live authority.

**Production delta: ZERO.** `LocalRuntimeHost.runTurn`
remains the live admission authority, unchanged.

**Recommended next candidate.** The next ACT should
re-evaluate the Factory Elm migration queue against larger
semantic surfaces (e.g. the long-horizon continuation
cardinality, the held-set progress classification, or
the completion-commit stage boundary) rather than this
12-case Boolean.

## 9. Residue

- P0: none.
- P1: none.
- P2 NON-BLOCKING:
  - SEAM05's existing 22-test mirror in
    `sdk/packages/core/src/runtime/turn-queue/admission-decision.test.ts`
    is preserved as a literal mirror of the production
    expression. It is no longer the primary evidence for the
    admission policy — the production seam at
    `local-runtime-host.ts:1227–1274` is.
  - No factory board ACT-owned deltas.

## 10. Gates

- `git status --short` → empty (before this report is added).
- `git diff --check` → exit 0.
- `git rev-parse HEAD` → `3eb40c5f8ed73e890452512e001b5af55daec9ff`.
- No typecheck / lint / test changes (no production delta).

## 11. Files

- **This report:**
  `.factory/ACT-CLINEMM-ELM-SEAM06-PROMPT-ADMISSION-CUTOVER.md`
- **Updated board:**
  `.factory/epic-board.md` (one new section appended at the
  end).
- **No source code changes.**

## 12. Predecessor ACT lineage

- `ACT-CLINEMM-ELM-SEAM05-PROMPT-ADMISSION-RECON`
  (`PASS_ELM_SEAM05_RECON`) — selected this production
  decision authority. The predecessor ACT's ENTRY_HEAD was
  `3bfba1582`; the current SEAM06 ENTRY_HEAD is
  `3eb40c5f8ed73e890452512e001b5af55daec9ff` (this ACT's
  entry point, per §1).
- All SEAM01–04 evidence preserved in
  `.factory/epic-board.md` and the per-ACT files in
  `.factory/`.
