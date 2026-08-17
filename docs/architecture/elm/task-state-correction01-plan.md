# ACT-CLINEMM-ELM-ARCHITECTURE01-E0-E4-BOOTSTRAP01-CORRECTION01

## Verdict entering

```text
ACT-CLINEMM-ELM-ARCHITECTURE01-E0-E4-BOOTSTRAP01
IMPLEMENTATION_FOUNDATION = STRONG
PASS_FROZEN_CLAIM         = NOT_YET_ACCEPTED
E5_E6_AUTHORIZED          = false
```

## Scope

Strictly narrow. NO cutover, NO production authority changes, NO context
work, NO effect interpreter. Only the model/reducer/explorer corrections
required to qualify E0-E4 for shadow-mode deployment.

## Required corrections

### COR01-A — Parallel-tool representation (R1)

Replace:

```ts
readonly tooling: boolean
```

with:

```ts
readonly activeToolCallIds: readonly string[]
```

`tooling` projection: `activeToolCallIds.length > 0`.

`tool_started(id)` adds the ID if not already present and increments
`toolCalls`. `tool_finished(id)` removes the ID only. This prevents
the false-idle bug where one of N parallel tools finishes but N-1
remain active.

### COR01-B — Stale activity / terminal guard matrix (R3)

Define the transition policy matrix as a documented contract:

```text
                model_stream_started   tool_started  approval_requested
idle             promote->running       promote->running   promote->running
running          valid                  valid              valid
resumable        IGNORED_STALE          IGNORED_STALE      IGNORED_STALE
completed        IGNORED_STALE          IGNORED_STALE      IGNORED_STALE
failed           IGNORED_STALE          IGNORED_STALE      IGNORED_STALE
cancelled        IGNORED_STALE          IGNORED_STALE      IGNORED_STALE
```

Apply the same terminal guard that `updateToolStarted` already has to
`updateModelStreamStarted` and `updateApprovalRequested`. Add a
`isStale(lifecycle)` helper and use it consistently.

`resumable` is not terminal in the strict sense, but for activity
purposes it behaves as "stopped epoch" — a future continuation via
`same_task_continued` is the only way out, and only after that does
activity become meaningful again.

### COR01-C — Edge-triggered execution adapter (R4)

`adaptRuntimeEvent` for `execution-state-changed` currently emits
messages from current booleans, not from the transition. Replace with:

```text
previousExecution = false, current = true  => *_started / *_requested
previousExecution = true,  current = false => *_finished / *_resolved
unchanged                                  => no TaskMsg
```

This makes the message algebra genuinely event-oriented.

The differential record keeps the LAST emitted TaskMsg (or null if none
was emitted), not a phantom message. The E4-DIFF-01 test should
still capture legacy=idle / shadow=streaming.

### COR01-D — Explorer dedup fix + known-bad sequence pins (R2)

The current explorer has an algorithmic defect: `seen.has(k)` returns
early BEFORE recursion, so descendants of dedup'd states are never
explored. Confirmed: with depth=4 and 15 representative messages, the
explorer processes 391 states and claims 0 violations, but the bare
reducer produces `resumable+streaming` (a violation) via a 3-step
path that the explorer never reaches because an earlier insertion at
depth 4 dedups the same JSON key at depth 1.

Fix:

- Walk into dedup'd states too (still record uniqueness for cycle
  detection at deeper depth).
- OR: dedup on `(state, depth)` instead of just `state`.

Add explicit "known-bad sequence" tests that pin the bugs the explorer
should now find:

- `task_became_resumable → model_stream_started` ⇒ `resumable_with_streaming`
- `task_completed → approval_requested` ⇒ `terminal_with_activity`, `approval_without_running_task`
- `tool_started(A) → tool_started(B) → tool_finished(A)` ⇒ tooling STILL true (activeToolCallIds = [B])

### COR01-E — Public-surface classification (R6)

The package-root `export * as TaskState from "./runtime/state/task-state"`
is mechanically a public surface change. Two options:

- (a) Move the export to a subpath (e.g. `@cline/agents/internal/task-state`)
  if the build system supports it.
- (b) Keep the namespace but document it as `STABILITY = PROVISIONAL/INTERNAL`.
  Mark it `@internal` via JSDoc and add a note to the migration board.

For this ACT, take (b) since it is the lower-impact change and matches
the upstream Cline convention of internal-only subpaths.

### COR01-F — Mutation-evidence rename (R9)

Rename `task-state.mutations.test.ts` to
`task-state.mutation-witness.test.ts` and document that each entry is a
witness matrix asserting the production behavior matches the expected
behavior — NOT a runtime mutation campaign. Add a separate
optional manual mutation sweep in `task-state.mutation-sweep.test.ts`
that actually applies mutations (via a `mutate()` helper) and
re-runs the assertion.

### COR01-G — ACT-scoped authoritative digest (R7)

Generate evidence over exactly `a9f376edf..HEAD`, not `HEAD~6..HEAD`.
Document the closure evidence explicitly in the report.

### COR01-H — Misc fixes

- `effects.ts` JSDoc says `EFFECT_EXECUTION_ENABLED` is "Always-true
  during E0-E4" but the value is `false`. Fix the comment.
- Update `MUTATIONS_APPLIED=10` claim in the migration board to
  `MUTATION_WITNESSES=10` since no actual mutation was run.

## Conservation

- ZERO production authority changes (still).
- ZERO `@cline/shared` public API change.
- ZERO context accounting changes.
- ZERO webview consumer changes.

## Closure gate

```text
PARALLEL_TOOL_EXACTNESS            = PASS
TERMINAL_STALE_MATRIX              = PASS
RESUMABLE_TRANSITIONS_DEFINED      = PASS
EXECUTION_ADAPTER_EDGE_TRIGGERED   = PASS

BOUNDED_EXPLORER_DEPTH_4           = PASS
KNOWN_BAD_SEQUENCES_PINNED         = EXPLICIT
PREVIOUS_ZERO_VIOLATION_CLAIM      = EXPLAINED

ACT_COMMITS                        = 4 (frozen) + N correction commits
PRODUCTION_AUTHORITY_CHANGED       = false
CONTEXT_ACCOUNTING_CHANGED         = false
CONTEXT_STASH_INTACT               = true

E5_E6_AUTHORIZED                   = true (after this ACT)
```