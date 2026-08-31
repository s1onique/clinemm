# ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02

> Status: **OPEN / HIGH** (LIVE-failure investigation)
>
> **Predecessor**: `ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION01` (REOPENED).
> CORRECTION01 (`3a198388d`) and CORRECTION02 (`dd694b6bc`) closed
> source-election bugs in `aggregateSource()` but did NOT reproduce
> the live `codium-factory` approval-card ASK with source
> `host_workspace_realpath_authority` that was the original
> investigation target. The live failure must be on a different
> code path.
>
> **Reviewer disposition**: `PASS_WITH_NONBLOCKING_RESIDUE C1: GO` from
> CORRECTION02 reviewer. P1 (source-kind coherence) closed. P2
> (documentary residue — premature claim that the live tool input is
> a single normalized element) corrected by rephrasing as a conditional.
> The exact live `toolInput` shape remains UNBOUND until the
> input-shape capture lands; this ACT is the bounded continuation.
> **Do not revisit `aggregateSource()` and do not broaden recon.**
> Get the exact live `toolInput → normalizedCommands` shape; that
> single observation decides the next causal branch.
>
> **Mission**: capture the exact normalized live tool input for a
> fresh `codium-factory` reproduction (input-shape capture + RED
> matrix below), then localize the actual causal seam and apply the
> bounded repair.

## 0. Mission

The CORRECTION01 RED stimulus (`commands: ["pwd", "cat <abs>"]`) and
the live specimen (`wc -l <abs> && cat <abs>`) are different shapes.
The canonical normalizer (`normalizeRunCommandsInput` in
`sdk/packages/core/src/extensions/tools/helpers.ts:137`) collapses
single-string `&&`/`;`/etc compounds to ONE element, while the
multi-element array shape is preserved verbatim. The single-element
shape is the live shape, and `aggregateSource()` early-returns at
`perCommand.length === 1` (line 644-646 of
`sdk/packages/core/src/runtime/command-policy/command-policy.ts`),
which means the CORRECTION01/CORRECTION02 source-election repair is
NOT on the causal path of the live failure.

The actual causal seam is somewhere else. The candidate paths:

1. **`evaluateOne` per-command resolution at line 540**: when
   `mode === "all"` and a safe rule matches (e.g. `cat`),
   `evaluateOne` returns ALLOW with the rule's `matchedRuleSource`
   without consulting `mode`/`mandatorySeatbelt`. This means a
   `cat` command with valid evidence always emits
   `host_mode_safe_only_rule` even under ALL+mandatorySeatbelt.
   The aggregate then sees `anySafeOnlyRule=true` but ALSO sees
   `(mandatorySeatbelt && mode=all)`, and step 6 fires first →
   `host_mode_safe_only_rule`. The lattice is ALLOW but the source
   is NOT `host_mode_all_seatbelt_required`. This is a different
   propagation bug from CORRECTION01/02.

2. **R5 catastrophic hard floor at `command-risk.ts:454`**:
   `evaluateCommandRiskWithParser` returns `never-auto-approve`
   disposition when the command matches a catastrophic family
   (e.g. `rm -rf`). The R5 composer at
   `sdk-tool-policies.ts:665-679` then overrides the policy
   verdict to ASK with source `risk_hard_floor`. This is already
   CORRECTION01-tested and known-good for `rm -rf "$HOME"`; the
   question is whether it ALSO fires for non-catastrophic R0
   commands when the parser result is unexpected.

3. **Stale-evidence binding at `command-policy.ts:329-411`**:
   the per-command path-authority gate returns
   `host_workspace_realpath_authority` ASK when:
     - `evidence === undefined`
     - `auth.workspaceRoots.length !== evidence.roots.length`
     - `auth.workspaceRoots[i] !== evidence.roots[i]`
     - `auth.cwd !== evidence.cwd`
     - `evidence.operands.length !== expectedOperands.length`
     - operand-identity mismatch
     - conformance fail (outside-root / symlink escape)
   For a single-element compound `wc -l X && cat X`, the
   `expectedOperands` extractor runs against the WHOLE compound
   string. `extractR0PathOperands(command, "host_safe_cat")` would
   return ALL operands after the leading `cat`, which is the
   WRONG operand extraction for a compound string. The expected
   vs actual operand identity binding then fails, and the
   per-command verdict is ASK `host_workspace_realpath_authority`.
   This is the most likely candidate for the live failure.

## 1. Recon contract

### RED file (next)

```text
apps/vscode/src/sdk/__tests__/seatbelt-all-workspace-realpath-authority-correction02.c0-live-shape.test.ts
```

### RED matrix (small and causal — per CORRECTION02 reviewer)

The reviewer-recommended matrix. Smaller than the original T-* set;
focuses on the necessity discriminator between "compound string
extraction is the defect" and "compound is a red herring".

```text
C0  EXACT LIVE INPUT SHAPE MECHANICALLY FROZEN
    Input: the live-shaped toolInput for the corr=XBQ0RRD7BC
           reproduction (string OR array, whichever the V2
           capture records for that correlationId).
    Output: toolInput shape frozen verbatim (no interpretation;
            the goal is to mechanically capture the shape that
            produced the live approval card).

C1  CONTROL_SIMPLE_CAT (POSITIVE CONTROL)
    Input: { command: "cat <abs-inside-root>/package.json" }
    Setup: contained operand + valid evidence + ALL +
           mandatorySeatbelt + correct R0 evidence
    Expected: ALLOW
    (A simple contained `cat` with correct R0 evidence is one of
     the healthy controls. If this fails, the live failure is
     NOT compound-specific; the simpler command path is also
     broken. STOP and reopen at the simpler path.)

RED COMPOUND (NECESSITY DISCRIMINATOR)
    Input: { command: "wc -l <abs-inside-root>/.../file.ts &&
                    cat <abs-inside-root>/package.json" }
    Setup: contained operands + valid evidence + ALL +
           mandatorySeatbelt
    Expected pre-fix: ASK / host_workspace_realpath_authority
    Expected post-fix: ALLOW /
                       host_mode_all_seatbelt_required /
                       mandatorySeatbeltExecution = true
    (If simple `cat` is ALLOW but compound becomes ASK /
     host_workspace_realpath_authority, you have an excellent
     necessity discriminator: the compound representation is
     the load-bearing trigger.)

ABL SAME-OPERANDS-BUT-SEPARATELY-NORMALIZED
    Input: { commands: ["wc -l <abs-inside-root>/.../file.ts",
                       "cat <abs-inside-root>/package.json"] }
    Setup: same operands, same evidence, same auth as RED COMPOUND
    Expected: classify whether failure depends on compound
              representation vs. shared operand identity.
    (If ABL reproduces the same ASK as RED COMPOUND, the failure
     is NOT compound-representation specific; it's operand-shape
     specific. If ABL is ALLOW but RED COMPOUND is ASK, the
     compound string is the load-bearing cause.)

C2  STALE EVIDENCE
    Input: same as C1 with operand-identity mismatch in evidence
    Expected: ASK (realpath gate preserved; this is the established
              behavior, included as a conservation control)

C3  OUTSIDE-ROOT
    Input: { command: "cat <abs-outside-root>/file.ts" }
    Expected: ASK (must NOT become ALLOW under ALL+Seatbelt;
              kernel is the containment gate; this is the established
              behavior, included as a conservation control)
```

### STOP rule (corrected)

```text
RED COMPOUND FAILS pre-fix (reproduces live failure)
  → causal binding RESTORED; continue with bounded repair on
    the identified seam (likely `extractR0PathOperands` for
    compound strings, or `evaluateOne` per-command).

C1 CONTROL_SIMPLE_CAT FAILS pre-fix
  → STOP. The defect is NOT compound-specific; the simpler
    command path is also broken. Reopen at the simpler path.

ABL reproduces the same ASK as RED COMPOUND
  → the failure is NOT compound-representation specific;
    it's operand-shape specific.

C0 EXACT LIVE INPUT SHAPE cannot be acquired
  → halt; cannot continue without the canonical shape
    evidence. Operator-driven runbook required.
```

## 1a. Input-shape capture probe (added 2026-08-30, CORRECTION02 review)

A default-off structural input-shape capture probe has been added
at the existing SDK-controller approval callback
(`apps/vscode/src/sdk/SdkController.ts`, alongside the existing
`approval.sdk-controller.authorization.v2` inner probe).

```text
codePoint: approval.sdk-controller.input-shape.v2
data: {
  sessionId,
  toolName,
  inputForm: "command" | "commands" | "other",
  commandsArrayLength,
  normalizedCommandsLength,
  normalizedKinds: ["string", ...]
}
```

Properties:
- **Default-off**: requires opt-in via
  `CLINEMM_DIAG_INPUT_SHAPE_V2=1` (any non-empty value).
- **No raw command contents**: structural data only. The existing
  `commandDigest` correlationId carries the verbatim content
  through the V2 capture context (operators correlate the specimen
  by correlationId, not by replaying the text).
- **Sentinel values**: `normalizedCommandsLength = -1` and
  `normalizedKinds = []` if the normalizer rejects the input;
  allows the operator to correlate the failure mode by
  correlationId.

### Classification tree (per CORRECTION02 reviewer)

For the fresh `codium-factory` reproduction:

#### Case S1 — one normalized element

```text
inputForm=command
normalizedCommandsLength=1
hostDecision=ASK / host_workspace_realpath_authority
```

Then the multi-element `aggregateSource()` fixes are definitively
unrelated to the live bug.

Next RED should drive the **exact compound string** through:

```text
normalizeRunCommandsInput
→ evaluateOne
→ extractR0PathOperands / realpath conformance
```

and inspect the exact reason.

This becomes the likely path:

```text
compound string
→ safe-rule match on part of string
→ path operand extraction against whole string
→ evidence identity/conformance mismatch
→ ASK / host_workspace_realpath_authority
```

But only promote that after RED.

#### Case S2 — multiple normalized elements

```text
inputForm=commands
normalizedCommandsLength>1
```

Then the previous dismissal of `aggregateSource()` as non-causal
was premature. In that case rerun the **exact live array shape**
against pre/post `3a198388d` and bind whether the independent
aggregate fix actually participates in the symptom.

#### Case S3 — unexpected input shape

```text
inputForm=other
```

Then halt at `CAPTURE_INSUFFICIENT` and trace the adapter
producing `run_commands` input. Do not repair policy yet.

## 2. Out-of-scope (defended against scope creep)

```text
OOS-1: aggregateSource() is NOT touched.
        The CORRECTION01/CORRECTION02 source-election fix is
        frozen; this ACT opens a different causal investigation.

OOS-2: The V2 parser-proven promotion path is NOT widened.

OOS-3: The R5 catastrophic hard floor is NOT weakened.

OOS-4: The executeSafeCommands toggle is NOT changed.

OOS-5: The session override projection is NOT changed.

OOS-6: The buildPathAuthorityEvidence result shape is NOT
        changed.

OOS-7: The live `codium-factory` approval-card rendering is
        NOT touched (UI is a downstream consumer).
```

## 3. Production seam (frozen)

```text
Live host authorization seam:
  apps/vscode/src/sdk/SdkController.ts:916..983 (resolveHostAuthorization closure)
  apps/vscode/src/sdk/SdkController.ts:2123..2169 (buildPathAuthorityEvidence)

Per-command resolution:
  sdk/packages/core/src/runtime/command-policy/command-policy.ts:227..584
    evaluateOne() — line 237
    deny rules check — line 242
    allow rules + safe-rule match + path gate — line 258..540
    mode-based resolution — line 549..584

R5 catastrophic hard floor:
  sdk/packages/core/src/runtime/command-policy/command-risk.ts:454
  apps/vscode/src/sdk/sdk-tool-policies.ts:665..679 (R5 composer override)

Path-authority evidence extraction:
  sdk/packages/core/src/runtime/command-policy/path-authority.ts:256
    extractR0PathOperands(command, source)
  sdk/packages/core/src/runtime/command-policy/path-authority.ts:625
    evaluateCommandRealpathConformance(evidence)

Canonical normalizer:
  sdk/packages/core/src/extensions/tools/helpers.ts:137
    normalizeRunCommandsInput(input)
```

## 4. Recon prerequisites

The recon ACT MUST acquire, before any further RED work:

```text
operator-driven LIVE capture of the exact toolInput for a fresh
codium-factory ASK / host_workspace_realpath_authority card, OR
a reasoned source-tree argument that the input is in fact a
single-element compound string (which is the live-shaped case).

If the latter, the capture can be deferred to the post-repair
qualification; if the former, the capture is the BLOCKING gate.

Acceptable capture shape:
{
  "toolInputShape": "{ command: string }",
  "normalizedCommands": ["wc -l <abs> && cat <abs>"],
  "renderedCommands": ["wc -l <abs> && cat <abs>"],
  "evidenceOk": true | false,
  "evidenceRoots": ["<realpath>"],
  "evidenceCwd": "<realpath>",
  "authMode": "all" | "safe-only" | "manual",
  "authMandatorySeatbelt": true | undefined | false,
  "authWorkspaceRoots": ["<realpath>"],
  "authCwd": "<realpath>",
  "commandPolicyDecision": {
    "kind": "ask",
    "source": "host_workspace_realpath_authority",
    "reason": "<verbatim reason text>"
  },
  "mandatorySeatbeltExecution": false
}
```

If this capture cannot be acquired in this authoring shell, the
ACT proceeds by reasoned source-tree argument (the live-shaped
case is the single-element compound) and the recon produces a
strong inference that the live failure is on the
`evaluateOne` per-command path (seam #1) or the
`extractR0PathOperands` path (seam #3). The actual repair is
gated on operator confirmation of the live toolInput shape.

## 5. Live-host qualification (operator-driven)

The ACT requires an operator-driven VSIX install + dogfood run on a
substrate-eligible shell (Terminal.app / iTerm2 / debug-harness).
The authoring shell is VSCodium-on-VM with `HAS_SUBSTRATE === false`,
which is insufficient for live-host qualification.

Acceptable operator runbook:
1. Build source-bound VSIX at HEAD (this ACT's commit).
2. Install at a clean userdata.
3. Drive the exact benign specimen from the capture, in the
   exact ClineMM UI flow, with a known YOLO session override armed
   and Seatbelt experimental opt-in set.
4. Capture: V2 trace JSONL; approval card text + source; final
   executor obligation (`mandatorySeatbeltExecution`).
5. Decision rule:
     - ASK / host_workspace_realpath_authority /
       mandatorySeatbeltExecution=false → RED REPRODUCED, causal
       binding RESTORED, continue to bounded repair on the
       identified seam.
     - ALLOW / host_mode_all_seatbelt_required /
       mandatorySeatbeltExecution=true → RED NOT REPRODUCED, the
       load-bearing live failure is NOT what the analyst
       thought. Reopen at the actual live failure (which the
       capture will reveal).

## 6. Exit criteria

```text
LIVE_CAPTURE_ACQUIRED = YES (or reasoned inference documented)
RED_REPRODUCED on the live-shape input
CAUSAL_SEAM_LOCALIZED to one of {evaluateOne, extractR0PathOperands,
                                R5 hard floor, parser-proven promotion,
                                unknown}
BOUNDED_REPAIR_APPLIED with conservation matrix ≥4 cases
REGRESSION_FREE across R5 / R0 / command-policy / sdk-tool-policies suites
COMMITTED with RED + GREEN in a single bounded commit
FACTORY_BOARD updated (epic-board.md + safe-yolo-seatbelt.md)
SEATBELT_PROFILE + EXECUTOR + CAPABILITY UNCHANGED
```

## 7. Halt conditions

```text
HALT_LIVE_INPUT_SHAPE_UNACQUIRED = cannot get toolInput shape
                                    AND no reasoned inference
HALT_SCOPE_EXPANDED               - touched aggregateSource(),
                                    executor, capability, profile
HALT_REGRESSION_INTRODUCED        - any R5 / R0 / command-policy
                                    / sdk-tool-policies test fails
HALT_DENY_RULE_BYPASS              - any host_hard_deny becomes ALLOW
HALT_REALPATH_OUTSIDE_ROOT_BYPASS  - any outside-root operand becomes ALLOW
HALT_R5_FLOOR_WEAKENED             - any R5 catastrophic becomes ALLOW
                                    without mandatorySeatbelt
HALT_EXECUTOR_FALLBACK             - spawnSupervisableShellCommand
                                    invoked when mandatorySeatbelt=true
```

## 8. Recon anchor points (frozen)

```text
SOURCE_OF_TRUTH:          sdk/packages/core/src/runtime/command-policy/command-policy.ts
                          (evaluateOne at line 237 + the path gate at line 316)
PRODUCER:                 apps/vscode/src/sdk/sdk-tool-policies.ts applySeatbeltAuthorityEnvelope (line 521)
SESSION_OVERRIDE:         apps/vscode/src/sdk/session-auto-approval.ts resolveSessionHostAuthorization (line 308)
HOST_AUTHORITY_SEAM:      apps/vscode/src/sdk/SdkController.ts resolveHostAuthorization (line 916)
                          apps/vscode/src/sdk/SdkController.ts buildPathAuthorityEvidence (line 2123)
EVIDENCE_BUILDER:         sdk/packages/core/src/runtime/command-policy/path-authority-evidence-builder.ts
                          (extracts operands from the WHOLE normalized command string,
                           not just the safe-rule prefix)
NORMALIZER:               sdk/packages/core/src/extensions/tools/helpers.ts:137
                          (collapses single-string &&/;/etc to one element)
R5_FLOOR:                 sdk/packages/core/src/runtime/command-policy/command-risk.ts:454
EXECUTOR:                 apps/vscode/src/sdk/command-job-manager.ts (CommandJobManager.start)
                          sdk/packages/core/src/runtime/sandbox/macos/seatbelt-backend.ts
                          (no changes to either)
```

## 9. Recon verdict (frozen; awaits ACT closure)

```text
LIVE_FAILURE_LIVE_TOOLINPUT_SHAPE = UNKNOWN (capture pending)
SUSPECTED_CAUSAL_SEAM = evaluateOne per-command + extractR0PathOperands
                         (single-element compound extraction is the
                          most likely path; must be confirmed via
                          operator-driven LIVE capture)
CAUSAL_BINDING_STATUS = BROKEN (live shape not reproduced in RED)
SUSPECTED_DEFECT_KIND = per-command verdict for compound single-element
                        strings — the safe-rule extractor may be
                        pulling operands from the WHOLE compound
                        rather than the safe-rule prefix

RECON_TARGET = localizing the per-command verdict for a single-element
               compound string under ALL+mandatorySeatbelt

REPAIR_SURFACE = TBD (depends on causal_seam_localized)
                 Likely candidates:
                 - command-policy.ts:316..412 (path gate for compound)
                 - command-policy.ts:237..545 (evaluateOne)
                 - command-policy.ts:549..584 (mode-based resolution)
                 - path-authority.ts:256..316 (extractR0PathOperands
                   for compound strings)

CONSERVATION = INV-1..INV-6 from CORRECTION01 still binding
               + new invariant: source ↔ kind coherence (closed by
                 CORRECTION02 dd694b6bc)

MAX_REVIEW_CYCLE = 1
```
