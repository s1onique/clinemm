# Conservation Report — ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SEAM01

## Authority OFF — byte-identical to legacy TS path

All pre-ACT tests pass unchanged:

- `background-completion-barrier01.bcb01.test.ts` (14/14) — BCB01 + CORRECTION01..04
- `background-completion-barrier01-correction*.bcb01-c*.test.ts` — BCB01-CORRECTION01..04
- `background-notify-completion-authority-c10-framework01.bnca-framework01.test.ts` — BNCA
- `background-notify-completion-authority-c10-framework-dispatch-failed01.bnca-framework01.test.ts`
- `completion-presentation-authority01.cpa01.test.ts` (14/14) — CPA01
- `post-consumption-completion-authority01.pcca01.test.ts`
- `continuation-cardinality-authority01.ccard01.test.ts` — CCARD
- `completion-authority-elm-shadow02.test.ts` (27/27) — Elm shadow observer
- `completion-authority-elm-historical-replay01.test.ts` — historical replay
- `completion-authority-trace-capture-extension01.test.ts` — TCE
- `completion-authority-commit-while-run-active-discriminator01.c24-c-bridge.test.ts` — CWRA

All 1246 bun unit tests pass.

The default option value (`defaultGetElmCompletionAuthorityDecision`)
returns `{kind: "authorize", reason: "elm_authority_off_default_authorize"}`
for every constructor invocation that does not pass the option. The
helper `checkElmCompletionAuthority` therefore returns `true` at every
commit site. The legacy TS predicate chain remains the sole authority.

## Single commit — exactly one production commit effect

EAS01-GREEN-B: Elm `kind: "authorize"` injected at the seam.
The TS predicate chain clears (no holds); Elm says `authorize`; the
commit effect fires exactly once. `setTurnPhase("completed", ...)` is
invoked once; the `TurnStateTracker` transitions to `completed` exactly
once. The C10 capture record is appended exactly once.

## Denial — zero commit effects

EAS01-RED-A: Elm `kind: "hold"` injected at the seam.
The TS predicate chain clears (no holds); Elm says `hold`. The helper
returns `false`; the production commit effect is suppressed. The
`setTurnPhase("completed", ...)` call is NOT invoked. A bounded
`Logger.warn` is emitted with the reason. The C10 capture record
HAS been appended (the CCARD helper runs unconditionally; the shadow
observer saw the record); only the downstream phase transition is
suppressed.

## Failure — zero commit effects + explicit classification

EAS01-RED-C1/C2/C3: Elm `kind: "failure"` (no_session / decode_error /
provider-throw) injected at the seam. The helper returns `false`;
the production commit effect is suppressed. A bounded `Logger.warn`
emits the bounded classification (`elm_authority_no_session` /
`elm_authority_decode_error` / `provider threw`). No silent TS
fallback. The C10 capture record HAS been appended; only the
downstream phase transition is suppressed.

## Duplicate / replay prevention — preserved

The `nextCompletionCommitEventId` field is preserved unchanged. The
BCB barrier still gates the deferred re-entry; the Elm decision sits
ON TOP of the existing TS gates. Two real C10 commits in the same
session still produce two distinct completionIds.

## Session isolation — preserved

The Elm decision is consulted per-call. Each `reevaluateDeferredCompletionBarrier`
call reads the live `options.getActiveSession()`; the C10 dispatch
site reads the live `options.sessions.getActiveSession()`. The
Elm decision does not introduce a per-session cross-talk surface.

## Background / pending-prompt conservation — preserved

The BCB barrier (BCB01 + CORRECTION01), the BNCA barrier, and the
PPCA barrier all run BEFORE the Elm check. The Elm check is the
FINAL gate, not a substitute for any TS predicate. All eight BCB01
+ CORRECTION01 + BNCA + PPCA predicates remain in place and continue
to gate the commit. BCB01 14/14 PASS confirms.

## CCARD conservation — schema unchanged

The CCARD capture helper continues to fire the `task_completion_committed`
record at L1531-1540 (initial C10 dispatch) and at the deferred barrier
seam. The Elm check happens AFTER the capture. The CCARD record schema
is unchanged. The shadow observer continues to see the record before
the Elm decision is consulted (so the Elm model is up-to-date).

## Elm shadow conservation — valid when authority mode is OFF

The shadow observer is a separate, prior module. It uses its own
state on `globalThis`. It is unaffected by the new constructor
option. The `applyElmShadowDiagnosticProfile` resolver continues to
work; the shadow continues to emit 1:1 DIRECT correspondence for
the canonical five events.

## Default OFF — no public semantic delta

When `CLINEMM_COMPLETION_AUTHORITY_ELM` is unset / false / off, the
default `getElmCompletionAuthorityDecision` returns `authorize`. The
legacy TS path is byte-identical. Public installs observe no
behavior change.
