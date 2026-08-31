# ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01

**Owner:** Safe-YOLO seatbelt (`safe-yolo-seatbelt.md`)
**Priority:** P1
**State:** OPEN / RECON_ONLY / NO_REPAIR / NO_RED
**Classification:** BOUNDED POLICY-RECONCILIATION CANDIDATE

## 0. Mission

Reconcile the live `54T24A8CE5` outside+inside ASK against the
prevailing tests, **without** consuming the bounded cardinality
repair at `f56e87af0` as policy-intent evidence. Determine whether
the intended product policy is:

```text
A. Outside reads SHOULD require approval under ALL+Seatbelt
   (host_workspace_realpath_authority is the data-authority boundary)
   => 54T24A8CE5 = NOT_A_DEFECT_POLICY_EXPECTED

B. Outside reads SHOULD auto-run sandboxed under ALL+Seatbelt
   (Seatbelt containment is sufficient; workspace authority is
    merely a pre-Seatbelt convenience)
   => current semantics are POLICY_SEMANTICS_DEFECT
   => a separate REPAIR01 is authorized

C. Product intent is genuinely undocumented / ambiguous
   => CAPTURE_INSUFFICIENT
   => operator / product-owner decision required
```

This ACT produces the source-tree evidence and the adversarial-case
inventory. **It does not pick A, B, or C.** That decision belongs to
the operator / product owner per the verdict's MISSION contract.

---

## 1. Entry facts (do NOT re-litigate)

```text
54T24A8CE5 IS REAL + LIVE:
  inputForm               = commands
  commandsArrayLength     = 2
  normalizedCommandsLength= 2
  normalizedKinds         = ["string","string"]
  resolvedMode            = all
  mandatorySeatbelt       = true
  pathAuthorityEvidenceOk = true
  finalDecision           = ask
  finalSource             = host_workspace_realpath_authority
  approval UI was actually published

Visible operands:
  outside workspace: /etc/profiles/per-user/chistyakov/bin/codium-clinemm
  inside workspace:  .../clinemm/.factory/evidence/.../live/...

Visible category: outside + inside (LIVE_CATEGORY_B / ABL_REVERSED).
The live category is OUTSIDE+INSIDE; not BOTH-INSIDE.

Cardinality sibling defect CLOSED at f56e87af0. It does NOT explain 54T24A8CE5.
Current post-fix policy tests deliberately say: outside + inside => ASK.
These tests describe CURRENT behavior, not necessarily desired product policy.
```

## 2. PHASE 1 — CONTRACT RECON (completed)

Open evidence directory:
```text
.factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/
  entry-freeze.txt              (HEAD capture; starting state)
  source-seam-map.md            (GATE A + GATE B + lattice + decision table)
  adversarial-case-inventory.md (hostile paths, smuggling, commands, network)
  final-report.md               (the recon deliverable; verdict + decision rule)
```

Conclusion of Phase 1: source-tree artifact explicitly states EITHER intent is absent. Both `host_workspace_realpath_authority` ASK and the curated Seatbelt read allowlist are individually coherent; the relationship between them is not adjudicated in code.

## 3. PHASE 2 — SECURITY MODEL (completed)

`source-seam-map.md` §3.4 enumerates the curated credential deny list (7 paths: `~/.ssh/id_*` + `~/.gnupg/private-keys-v1.d/`). The deny list is only activated when Seatbelt is active AND the network opt-in is set. Under the default posture (network=DENY), `denyReadSubpaths = []` and Seatbelt permits reading **any** host file the macOS filesystem permits the process user to read.

`source-seam-map.md` §3.6 enumerates what GATE B does and does not prevent. Key finding: **Seatbelt containment != "safe to expose host file contents to the model".** A sandboxed process can still `cat /etc/profiles/per-user/...` and emit the contents to stdout, which becomes a tool result in model context.

## 4. PHASE 3 — PRODUCT SEMANTICS (completed)

`source-seam-map.md` §6 produces the 3x3 decision table (mode x operand class). Every cell is filled with the value the production tests assert today. The question is whether each cell is the intended policy.

`source-seam-map.md` §5 notes the upstream baseline: `autoApprove: true` upstream means "run without asking" but Cline supports command-permission restrictions separately. Therefore upstream semantics alone do not answer whether ClineMM workspace authority is intended to override ALL. Treat as context, not proof.

## 5. PHASE 4 — ADVERSARIAL CASES (completed)

`adversarial-case-inventory.md` enumerates:
```text
  §2 hostile paths (read privacy)
  §3 symlink / process-side realpath games
  §4 two-element arrays mixing inside/outside operands (smuggling)
  §5 adversarial commands (cat, wc, head, md5, file, stat, find ...)
  §6 privacy/density tradeoff (privacy classes)
  §7 network-egress implications (when network=allow is also set)
  §8 the real question for the operator / product owner
```

None of these are derivable from source. They are the input the operator / product owner needs to choose between A, B, C.

## 6. PHASE 5 — DECISION (NOT made in this ACT)

Per the verdict MISSION contract, this ACT must NOT make the decision. The decision belongs to the operator / product owner.

Three admissible verdicts (verbatim from the MISSION contract):

```text
NOT_A_DEFECT_POLICY_EXPECTED
  if outside reads intentionally require approval even under
  ALL + mandatory Seatbelt.
  Then:
    - classify 54T24A8CE5 as expected
    - close this specimen
    - keep R5 manual-approval lane waiting for a genuinely incorrect prompt
    - no production change

POLICY_SEMANTICS_DEFECT
  only if repository/product doctrine establishes that ALL +
  mandatory Seatbelt should suppress approval for this class.
  Then:
    - define precise allowed class (per-command, per-privacy-class)
    - write a real-seam RED
    - prove Seatbelt provides the required protection
    - preserve adversarial outside-read privacy invariants
    - authorize separate REPAIR01

CAPTURE_INSUFFICIENT
  if product intent is genuinely undocumented/ambiguous.
  Then stop and require an explicit policy decision from operator/product owner.
```

---


## 7. Explicit non-goals

```text
  - No production code changes.
  - No new tests (existing tests cover the source-election paths).
  - No new v2 capture probe.
  - No repair attempt.
  - No opening of …REPAIR01 from within this ACT.
  - No reopen of the closed R5 ACT.
  - No reopen of …CORRECTION02 (the cardinality repair is its own lane).
  - No "ALL means everything, always allow."
  - No global bypass of host_workspace_realpath_authority.
  - No use of the cardinality fix as evidence for policy intent.
  - No equating read-only with harmless.
  - No equating Seatbelt process containment with permission to expose host file contents to the model.
  - No Idle work.
  - No R0 reopening.
```

## 8. STOP conditions

```text
  - Stop after the final-report is written and committed.
  - Do not enter another review round unless a NEW P0 appears.
  - Do not bundle this with …CORRECTION02 (separate lane).
  - Do not bundle this with the R5 ACT (separate lane).
  - Do not preempt the operator / product-owner decision.
```

## 9. Production seam (frozen, recon-only)

```text
Live host authorization seam (READ-ONLY):
  apps/vscode/src/sdk/SdkController.ts:916..983        (resolveHostAuthorization)
  apps/vscode/src/sdk/SdkController.ts:2123..2169      (buildPathAuthorityEvidence)

Per-command resolution:
  sdk/packages/core/src/runtime/command-policy/command-policy.ts:227..584
  command-policy.ts:329..411                            (path-authority gate)
  command-policy.ts:640..760                            (aggregateSource + R5 strict-suppressor)

Path-authority evidence extraction:
  sdk/packages/core/src/runtime/command-policy/path-authority.ts:256
  path-authority.ts:625                                  (evaluateCommandRealpathConformance)

Canonical normalizer:
  sdk/packages/core/src/extensions/tools/helpers.ts:137
  normalizeRunCommandsInput(input)

Seatbelt filesystem containment:
  sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:153-162 (buildReadRule)
  sdk/packages/core/src/runtime/sandbox/macos/seatbelt-profile.ts:374-375 (file-read-metadata)

Production capability builder:
  apps/vscode/src/sdk/sandbox-policy.ts:656-734          (resolveSafeYoloSensitiveReadDenials)
  apps/vscode/src/sdk/sandbox-policy.ts:892-933          (buildExperimentalReconCapability)

Curated credential set contract:
  apps/vscode/src/sdk/__tests__/darwin-seatbelt-safe-yolo-sensitive-read-confinement01.c2-green.test.ts:14-31
  + R10/R11 invariants at lines 409-471
```

## 10. Inputs to the next ACT (if any)

```text
If the operator / product owner chooses NOT_A_DEFECT_POLICY_EXPECTED:
  - 54T24A8CE5 closes as EXPECTED.
  - R5 manual-approval lane waits for a genuinely incorrect specimen.
  - No production change. This ACT may close as PASS_RECON_NO_DEFECT_FOUND_V1.

If the operator / product owner chooses POLICY_SEMANTICS_DEFECT:
  - Open ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-REPAIR01.
  - The REPAIR01 ACT MUST:
    - Define the precise allowed class (per-command, per-privacy-class).
    - Write a real-seam RED that proves the fix does NOT auto-approve the
      adversarial cases enumerated in adversarial-case-inventory.md §2-§7.
    - Prove Seatbelt provides the required protection (or expand the
      curated credential deny list to cover the gaps enumerated in §2).
    - Preserve adversarial outside-read privacy invariants.
    - Reclassify the Live 54T24A8CE5 specimen: still mirrors the live
      category, but now pre-fix RED must show ASK (fail-closed)
      and post-fix GREEN must show ASK (still gated, by the new class).
    - This ACT does NOT predetermine that outcome.

If the operator / product owner chooses CAPTURE_INSUFFICIENT:
  - Halt. Do not repair.
  - Require explicit policy decision.
  - This ACT closes as PASS_RECON_CAPTURE_INSUFFICIENT_V1.
```

## 11. ACT closure (this ACT, the recon)

```text
STATUS                 = RECON_COMPLETE / NO_REPAIR / NO_RED / CLOSED
BOUNDARY               = policy/contract reconciliation, not repair
SOURCE_SEAM_MAP        = .factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/source-seam-map.md
ADVERSARIAL_INVENTORY  = .factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/adversarial-case-inventory.md
FINAL_REPORT           = .factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/final-report.md
VERDICT_RECORD         = .factory/evidence/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01/verdict-record.md
DECISION               = NOT_A_DEFECT_POLICY_EXPECTED
POLICY                 = WORKSPACE_IS_DATA_AUTHORITY_BOUNDARY
54T24A8CE5             = CLOSED_EXPECTED
R5_MANUAL_APPROVAL_LANE = STILL OPEN (new trigger shape documented in §13;
                        awaiting genuinely erroneous specimen only)
CORRECTION02_LANE      = CLOSED (no impact; sibling defect, not this lane)
PRODUCTION_DELTA       = NONE
C1_VERDICT             = GO  (operator: "No outside-read REPAIR01")
BOARD_DELTA            = epic-board.md + safe-yolo-seatbelt.md updated
```

---

## 12. Predecessor + sibling links

```text
Predecessor (live-failure investigation):
  ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02 (CLOSED REPAIRED; CLAIM REVISED)
  54T24A8CE5 not bound; R5 manual-approval lane remains open pending this reconciliation

Sibling recon (R0 obligation propagation):
  ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01 (OPEN / RECON_ONLY / NO_REPAIR)
  Not bundled; separate lane.

Sibling ACTs in the safe-yolo-seatbelt epic:
  ACT-CLINEMM-SEATBELT-NETWORK-EGRESS-RECON01                    (CLOSED PASS)
  ACT-CLINEMM-SEATBELT-NETWORK-LIVE-DOWNSTREAM-RECON01           (CLOSED PASS)
  ACT-CLINEMM-SEATBELT-SSH-AGENT-AUTHORITY-IMPLEMENTATION01     (CLOSED PASS)
  ACT-CLINEMM-SEATBELT-YOLO-COMPLETION-AUTHORITY-IMPLEMENTATION01 (CLOSED PASS)
  ACT-CLINEMM-SEATBELT-ALL-R5-AUTHORITY-IMPLEMENTATION01         (CLOSED PASS)

Upstream basis (context, not proof):
  permission-handling.mdx (cline/cline docs)
  "autoApprove: true means run without asking; Cline also supports
  command-permission restrictions separately."
```


## 13. Operator verdict (post-ACT, recorded for closure)

**Recorded by:** operator (Product-security architect + Factory reviewer) on 2026-08-31 via the verdict prompt.

```text
ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01

DECISION =
  NOT_A_DEFECT_POLICY_EXPECTED

POLICY =
  workspace realpath authority IS a data-authority boundary;
  ALL does NOT bypass it

54T24A8CE5 =
  CLOSED_EXPECTED

PRODUCTION_CHANGE =
  NONE

R5_MANUAL_APPROVAL_LANE =
  OPEN, awaiting genuinely erroneous specimen

NEXT_R5_TRIGGER =
  ASK under ALL+mandatorySeatbelt where ALL applicable authority
  conditions ARE satisfied:
    - mode = all
    - mandatorySeatbelt = true
    - all path-bearing operands INSIDE authorized workspace roots
      (or no path authority is relevant)
    - no explicit deny / hard floor / missing evidence
  BUT finalDecision = ask AND approval UI published

C1: GO. No outside-read REPAIR01.
```


### Why `ALL` does NOT override workspace authority

Upstream Cline `autoApprove: true` baseline executes tools without asking, but separately supports conditional permission logic and warns that "auto approve everything" is appropriate only in a fully trusted or sufficiently sandboxed environment. ClineMM is intentionally stronger than that baseline. The operator authoritative definition of `ALL`:

> **Auto-approve every operation that has already satisfied the applicable security/data-authority constraints.**

Not:

> Bypass all authorization boundaries.

This gives `ALL` coherent semantics without turning it into `--dangerously-disable-everything`:

```text
  explicit DENY              still wins
  stale authority evidence   still fails closed
  risk hard floor            still wins
  outside data authority     still asks
  mandatory Seatbelt         controls execution after ALLOW
```

### Why `54T24A8CE5` specifically is EXPECTED

The outside operand on the live specimen was:

```text
  /etc/profiles/per-user/chistyakov/bin/codium-clinemm
```

It happens to be benign. But the policy cannot safely distinguish benign by inspecting the file content — the same primitive can target:

```text
  ~/.aws/credentials
  ~/.kube/config
  ~/.netrc
  ~/.git-credentials
  ~/.bash_history  ~/.zsh_history  ~/.python_history
  ~/.mysql_history  ~/.psql_history
  ~/.ssh/config    ~/.ssh/known_hosts    ~/.ssh/known_hosts2
  /Users/<other-user>/...
  /Volumes/<other-volume>/...
  /etc/passwd      /etc/shadow (perms-dependent)
```

(See `adversarial-case-inventory.md` §2 for the full inventory.) The manual prompt was correct; the live ASK is the policy working as intended, not a defect.



### Out of scope for this lane (recorded, NOT acted on)

The operator surfaced one **P2 product-copy/usability item** that this ACT does NOT touch:

```text
  Current UI copy:  "Auto-approve: ⚡ ALL — this task"
  Suggests:         "I will never be asked."
  Reality:          "ALL eligible operations, subject to security/
                     data-authority gates."

  Future UX copy (suggested):  "Auto-approve: ALL safe operations"
  or shorter:                  "Auto-approve: ALL*"
  with explanation:
    "Operations crossing workspace, security, or explicit-deny
     boundaries can still require approval."
```

This is a separate small product-copy/usability item. It is NOT part of this R5 lane and is NOT introduced by any production change here.

### P2 residue items in the supplied digest (recorded, NOT acted on)

Per operator: "None should block execution under our policy."

```text
  - git diff --check: four blank lines at EOF
  - gate-summary:     stale/invalid schema
  - Leamas:           generator/subject identity warning
```

These are pre-existing P2 hygiene items outside the scope of this ACT and the safe-yolo-seatbelt epic. They do not affect the verdict or the closure of this ACT.

### Verbatim sources cited by the operator (post-ACT, recorded for completeness)

```text
  [1] anthropic-experimental/sandbox-runtime  (upstream default read model:
      "allow everywhere unless denied"; doc recommends denying broad
      host regions and selectively re-allowing the workspace when
      filesystem confidentiality matters)

  [2] cline/cline/docs/sdk/guides/permission-handling.mdx  (upstream
      autoApprove baseline: "run without asking" + separate command-
      permission restrictions; warns "auto approve everything" only in
      fully trusted or sufficiently sandboxed environment)
```

These corroborate the policy semantics but are NOT proof of ClineMM intent; ClineMM is intentionally stronger than the upstream default.


---

## 14. Closure summary

```text
ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01

PRE-VERDICT (this ACT produced):
  POLICY_INTENT_FOR_OUTSIDE_READS_UNDER_ALL_SEATBELT =
    UNDOCUMENTED_OR_AMBIGUOUS_IN_SOURCE
  54T24A8CE5_CLASS =
    NOT_A_DEFECT_UNTIL_POLICY_DECISION_LANDS

POST-VERDICT (operator decision):
  DECISION  = NOT_A_DEFECT_POLICY_EXPECTED
  POLICY    = WORKSPACE_IS_DATA_AUTHORITY_BOUNDARY
  54T24A8CE5 = CLOSED_EXPECTED

CLOSED_PASS_RECON_NO_DEFECT_FOUND_V1

NEXT_R5_TRIGGER_SHAPE =
  ASK under ALL+mandatorySeatbelt where ALL applicable authority
  conditions ARE satisfied
  (see §13 for the precise predicate)

PRODUCTION_DELTA = NONE
PENDING_ITEMS    = 1 P2 UX-copy residue (out of lane; see §13)
```

---

