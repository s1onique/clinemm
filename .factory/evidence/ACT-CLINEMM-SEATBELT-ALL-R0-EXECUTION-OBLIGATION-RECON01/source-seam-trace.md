# ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01 — Source-Seam Static Trace

**Scope**: read-only structural analysis of the candidate defect
path under `mode=all + mandatorySeatbelt=true` for a single-element
contained R0 path-bearing command. No production code changes; no
new tests; no new v2 capture probe.

**Method**: line-anchored trace of every site the candidate codepath
touches, followed by structural comparison with the already-repaired
multi-element path.

---

## 1. The candidate codepath (single-element contained R0 safe rule)

### Step 1: top-level entry — `evaluateCommandPolicy`

`sdk/packages/core/src/runtime/command-policy/command-policy.ts:95-117`

```ts
const perCommand = resolvePerCommand(
    normalization.commands,                       // [single normalized command]
    input.hostAuthorization,                     // { mode: "all", mandatorySeatbelt: true, ... }
)
const aggregateKind = aggregateLattice(perCommand)
const modelHints = parseCommandModelHints(input.toolInput)
let finalKind = aggregateKind
let finalReason = aggregateReason(perCommand)
let finalSource = aggregateSource(perCommand, input.hostAuthorization, finalKind)
```

For our candidate input:
- `normalization.commands.length === 1`
- `perCommand.length === 1`
- Each `perCommand[0]` was produced by `evaluateOne(normalized, auth)`
  (line 237).

### Step 2: per-command evaluation — `evaluateOne`

`sdk/packages/core/src/runtime/command-policy/command-policy.ts:237-585`

The candidate command matches an explicit allow rule at line 252
(`findSafeRuleMatch(command, allowRules)`). The downstream workspace
realpath authority checks pass (operands resolve inside
`workspaceRoots`). The function reaches line 538:

```ts
// 538
const profile = getSafeExecutionProfileForSource(match.source);
return {
    kind: "allow",
    source: "host_mode_safe_only_rule",          // <<< HERE
    reason: `host-proven safe (${match.source})`,
    matchedRuleSource: match.source,
    safeExecutionProfile: profile,
};
```

**The explicit allow rule short-circuits to `host_mode_safe_only_rule`
WITHOUT consulting `auth.mandatorySeatbelt`. The conditional
Seatbelt-ALL branch at line 558 is unreachable on this path.**

### Step 3: aggregate source — `aggregateSource`

`sdk/packages/core/src/runtime/command-policy/command-policy.ts:640-759`

For our candidate input (`perCommand.length === 1`):

```ts
// 642
function aggregateSource(perCommand, auth, aggregateLatticeKind) {
    if (perCommand.length === 1) {
        return perCommand[0]!.source;             // <<< HERE (line 644)
    }
    // ... multi-element logic below
```

**The single-element short-circuit returns `perCommand[0].source`
UNCONDITIONALLY. The strict-suppressor at line 745 (which handles the
multi-element case) is unreachable on this path.**

So `finalSource = "host_mode_safe_only_rule"` (the value returned by
`evaluateOne`).

### Step 4: consumer mapping — `sdk-tool-policies.ts:710`

`apps/vscode/src/sdk/sdk-tool-policies.ts:710`

```ts
mandatorySeatbeltExecution: result.decision.source === "host_mode_all_seatbelt_required",
```

Since `result.decision.source === "host_mode_safe_only_rule"`, this
expression evaluates to `false`.

### Step 5: enforcement gate — `command-job-manager.ts:591-614`

`apps/vscode/src/sdk/command-job-manager.ts:591-614`

```ts
// 613
const mandatorySeatbeltExecution = context?.mandatorySeatbeltExecution === true
if (mandatorySeatbeltExecution && resolveExperimentalSandboxMode() === undefined) {
    // ... Seatbelt enforcement active
}
```

Since `mandatorySeatbeltExecution === false`, Seatbelt enforcement
does not activate on this path.

---

## 2. Comparison with the repaired multi-element path

The multi-element path (already repaired by
`ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01`
+ `CORRECTION02`) correctly applies a strict-suppressor at
`command-policy.ts:745`:

```ts
// 745
if (anySafeOnlyRule) {
    if (!(seatbeltObligationActive && aggregateLatticeKind === "allow")) {
        return "host_mode_safe_only_rule"
    }
    // else fall through to step 7 at line 757
}
// 757
if (anyAllSeatbeltRequired || (auth.mandatorySeatbelt === true && auth.mode === "all")) {
    return "host_mode_all_seatbelt_required";
}
```

So for `perCommand.length >= 2`, when `seatbeltObligationActive`
(= `auth.mandatorySeatbelt === true && auth.mode === "all"`) AND the
aggregate lattice is `allow`, the strict-suppressor falls through
and step 7 returns `host_mode_all_seatbelt_required`. The
multi-element invariant is therefore **PRESERVED**.

For `perCommand.length === 1`, line 644 short-circuits before the
strict-suppressor can fire. **The single-element invariant is therefore
VIOLATED in the current source.**

---

## 3. Empirical coverage check (existing tests)

A `grep` of the existing test files in
`sdk/packages/core/src/runtime/command-policy/` for the string
`mandatorySeatbelt` returned:

```
$ grep -rn 'mandatorySeatbelt' sdk/packages/core/src/runtime/command-policy/*.test.ts
(no matches)
```

So **NO existing test exercises `mandatorySeatbelt === true`** in
the command-policy test suite. The strict-suppressor paths at
lines 558 (per-command mode branch) and line 745 (multi-element
aggregate) are structurally present and were covered by the
`…R5-AUTHORITY-IMPLEMENTATION01` evidence tree (per the epic
history), but the single-element short-circuit at line 644 was
NOT covered by any explicit single-element assertion.

**Conclusion**: the candidate defect is **structurally real** in
the current source, and the existing test suite does not assert
either the desired invariant OR the current behavior for the
candidate path.

> **Reviewer residue (2026-08-31, Factory review)**:
> The phrase "existing tests already cover the source-election
> paths structurally" is fine only insofar as those tests
> exercise the production functions rather than restating
> expected constants. When the eventual `…REPAIR01` ACT begins,
> the RED MUST be a single-element contained path-bearing command
> under `(mode=all + mandatorySeatbelt=true)` that binds the **real
> production policy seam** (not a helper-only reconstruction).
> If that RED does not reproduce, halt as
> `HALT_RED_NOT_REPRODUCED` even though the static source looks
> wrong. Per-source code-reading is not a substitute for a RED
> that reproduces the defect through the real seam.
> Evidence label for the empirical-coverage claim:
> `EMPIRICAL_COVERAGE = STRUCTURAL_PRESENCE_ASSERTED_BUT_PRODUCTION_BINDING_NOT_VERIFIED`.

---

## 4. Live-binding analysis

The codium-factory intermittent approval-card live failure
remains owned by `…CORRECTION02`. That ACT's review residue
documents that the UI rendering is NOT sufficient evidence; what
is actually known is that *if* the live request arrived as
`{ command: "wc ... && cat ..." }` then `normalizeRunCommandsInput`
gives one element, and that element hits the same single-element
short-circuit at line 644.

The candidate ACT's defect path therefore has a NON-ZERO
probability of being on the live failure's path. Whether the
intermittent failure is actually caused by this single-element
short-circuit (versus the multi-element aggregate precedence issue
that `…CORRECTION02` already repaired) requires live
reproduction under the existing
`approval.sdk-controller.authorization.v2` v2-capture probe —
which is the operator's responsibility, NOT this ACT's
responsibility.

---

## 5. Static verdict

**`STATIC_VERDICT = REAL`**

The candidate defect is structurally real in the current source:

1. `evaluateOne` at line 538-546 short-circuits to
   `host_mode_safe_only_rule` for any explicit allow rule match,
   never consulting `auth.mandatorySeatbelt`.
2. `aggregateSource` at line 644 short-circuits to
   `perCommand[0].source` for any single-element input, never
   consulting `auth.mandatorySeatbelt` either.
3. `sdk-tool-policies.ts:710` then maps the source label to
   `mandatorySeatbeltExecution: false`.
4. `command-job-manager.ts:613-614` then skips Seatbelt
   enforcement.

The desired invariant is violated on the candidate path.

**Per-element evidence labels (preserved per Factory review discipline;
2026-08-31)**:

```text
evaluateOne defect              = STRUCTURAL
aggregateSource defect          = STRUCTURAL
propagation into SDK policy     = STRUCTURAL
Seatbelt-skip reachability      = STRUCTURAL
real dogfood occurrence         = LIVE_UNVERIFIED
actual user-visible consequence = LIVE_UNVERIFIED
```

This label discipline is critical: STRUCTURAL proves the source
shape, but only LIVE can prove causality. Conflating them is the
exact chronology→causality promotion the Factory rules forbid.

**`LIVE_VERDICT = LIVE_UNVERIFIED`** (cannot run live reproduction
in this shell; no headed dogfood host available; no bun-installed
substrate available).

**`DISPOSITION_CANDIDATE = SUPERSEDED_BY_CORRECTION02`**
(REAL + LIVE_UNVERIFIED → treat as bounded latent defect; one row
in this epic only; operator MAY reopen this lane for live
reproduction under the `…CORRECTION02` umbrella OR under a fresh
`…REPAIR01` ACT when sufficient evidence is collected).

The final-report.md file formalizes this verdict and adds the
epic-board update.