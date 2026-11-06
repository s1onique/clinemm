# ACT-CLINEMM-COMPLETED-TASK-COMPACTION-AUTHORITY01

**Class:** ACT — bounded production repair
**Verdict:** `PASS_STRUCTURAL_ONLY`
**Entry head:** `c0cb2f6797e02fb1ff96672807b7fb8aae767959`
**Final head:** `85b4a6edc02a9b9546b5e159838bd32ff176dbf3`
**Branch:** `main`

---

## Mission

Determine why a task the ClineMM VSCode extension presents as
`✓ Complete` (composer `Start New Task`) is nevertheless refused by
manual compaction with `Cannot compact while a response is in progress.
Try again once the current turn finishes.`, and fix the proven defect
without weakening any safety guard.

**Primary invariant.** Manual compaction must operate on the intended task
only when its actual execution and transcript state are safe to compact.
Displayed completion must not falsely imply that required execution or
observation has finished.

---

## Reported symptom

Observed 2026-11-05 on task/session `1793873645457_fg2wh`, whose content
references `ACT-CLINEMM-BACKGROUND-EXEC-SIGNAL-AUTHORITY-BOUNDARY-RECON02`:

- Task header: `✓ Complete`
- Composer: `Start New Task`
- Manual compaction: rejected twice with `Cannot compact while a response
  is in progress. Try again once the current turn finishes.`
- Purple banner: deferred completion awaiting observation of unconsumed
  terminal results.

**Evidence classification: `LIVE_UI_ONLY`.** It proves the visible
contradiction. It does NOT prove that execution was idle, that the
completion indicator was wrong, or that compaction should have been
allowed.

---

## Root cause

**`STALE_RUNTIME_BUSY`.**

`SdkSessionEventCoordinator.reevaluateDeferredCompletionBarrier` commits
the terminal `completed` phase — the phase the webview projects as
`✓ Complete` / `Start New Task` — but performs **no running-state
transition**.

The immediate commit path performs that transition at the tail of the
turn-complete block (`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:5882`),
but the deferred branches `return` before reaching it (`:5457`).

The host-owned BCB continuation is delivered through
`sdkHost.send({ delivery: "queue" })`
(`apps/vscode/src/sdk/SdkController.ts:1040-1049`) and NOT through
`fireAndForgetSend`, so that turn has **no send-settlement owner** that
could mark the session idle either.

Result: after the deferred completion is released, `phase === "completed"`
while `activeSession.isRunning === true`. Every `isRunning` consumer then
disagrees with the UI — the manual compaction guard rejects (THE LIVE
SYMPTOM), the passive rebuild scheduler never drains, and provider / mode
/ terminal rebuilds are refused.

### Eliminated alternatives

| Candidate | Verdict | Why |
|---|---|---|
| `PREMATURE_UI_COMPLETE` | eliminated | The commit is authorized and intended. |
| `WRONG_COMPACTION_TARGET` | eliminated | The task id IS the session id (`SdkController.ts:1275`). |
| `TURN_SETTLEMENT_RACE` | eliminated | The `turnGeneration` fence is intact and was exercised. |
| `DEFERRED_COMPLETION_PENDING` | eliminated | The banner is a historical row; the obligation is settled at release. |

---

## The repair

**ONE executable statement** (`apps/vscode/src/sdk/sdk-session-event-coordinator.ts:3015`):

```ts
this.options.sessions.setRunning(false)
```

The SAME lifecycle transition the immediate commit path already uses,
performed at the deferred commit site.

**Not changed:** the compaction guard (it still reads `isRunning`), the
barrier's predicates and hold branches, the Elm completion authority, the
lifecycle's `turnGeneration` fence, the compaction mutex and its re-check,
the protocol surface, React, and every persistent schema.

**Why it is safe.** The release is reachable only after EVERY conservation
predicate cleared (no running task-owned background job, no queued prompt
with an AVAILABLE pending-prompt authority, no notify marker, no unconsumed
owned terminal result, no unresolved containment failure, no wake-driven
ownership), and it is identity-fenced on session id / task id / epoch. Every
HOLD branch returns before the new line.

---

## Evidence

`.factory/evidence/ACT-CLINEMM-COMPLETED-TASK-COMPACTION-AUTHORITY01/`

| File | Contents |
|---|---|
| `recon.md` | Ownership map (9 questions, source paths + line ranges) and the production gap. |
| `red.txt` | The RED witness — the single production line ablated; exactly 1 test fails, the 5 negative-control / conservation cases still pass. |
| `causality.md` | Classification, the causal chain (T1..T8), the observed state trace, the necessity / ablation, and the safety argument. |
| `green.txt` | Focused test + 14 neighbouring regression suites: 228 passed / 228. |
| `identity.txt` | Source + artifact identity and every gate's exit code. |
| `live.txt` | Installed qualification: `NOT_EXECUTED` (operator authorisation required). |
| `close.md` | Final decision and remaining limits. |

---

## Gates (all observed)

| Gate | Result |
|---|---|
| Focused RED→GREEN test | exit 0 — 6 passed |
| RED witness (single line ablated) | exit 1 — 1 failed / 5 passed |
| Neighbouring regression suites (15 files) | exit 0 — 228 passed |
| `bunx tsc --noEmit -p tsconfig.json` | exit 0 — no diagnostics |
| Biome lint + format (affected files) | exit 0 |
| `bun esbuild.mjs` | exit 0 |
| Full vitest sweep, regression delta vs. the SAME baseline | `only-in-mine` EMPTY (files AND tests) |

ACT-owned diagnostics end at ZERO. The 62 remaining full-suite failing
files are pre-existing baseline failures, identical with and without this
ACT.

---

## Commits

- `85b4a6edc` — `fix(clinemm): correct the deferred-completion
  running-state transition (CTCA01)` (the RED test and the repair are
  committed together; the RED/GREEN provenance is preserved by the
  ablation witness in `red.txt`).

---

## Remaining limits (P2, non-blocking)

1. No installed-extension qualification (`live.txt` = `NOT_EXECUTED`). The
   FINAL_HEAD artifact and its SHA256 are recorded in `identity.txt` for an
   operator-authorised install.
2. The pre-existing "a newer user turn starts inside the release window"
   residue is unchanged; it belongs to `PREMATURE_UI_COMPLETE`, not here.
3. The deferred-completion banner row is a historical row; it was
   determined unrelated to the compaction rejection and deliberately not
   changed.
4. 62 pre-existing full-suite failures remain, untouched.
