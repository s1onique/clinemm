# Final report — ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01

Read-only recon. NO production repair. NO new RED. NO new v2 capture
probe. Updates only the Safe-YOLO Seatbelt epic row
`R5_MANUAL_APPROVAL_LANE` and the relevant epic detail file.

---

## 1. The reconciled question

> Should a read-only command referencing a path outside the workspace require manual approval when `mode=all` and mandatory Seatbelt is active?

Per the verdict MISSION contract, this ACT does NOT decide the answer. It produces the source-tree evidence (source-seam-map.md) and the adversarial-case inventory (adversarial-case-inventory.md). The decision belongs to the operator / product owner.

## 2. Source-tree verdict

```text
POLICY_INTENT_FOR_OUTSIDE_READS_UNDER_ALL_SEATBELT = UNDOCUMENTED_OR_AMBIGUOUS_IN_SOURCE
  - GATE A (host policy) has a realpath conformance fail-closed behavior
    that always ASK on outside operands
  - GATE B (Seatbelt filesystem containment) has BROAD read allow
    (`(allow file-read*)`) plus a SMALL curated credential deny list
  - No source-tree artifact explicitly says either:
      "workspace authority is the data-authority boundary even under Seatbelt"
      OR
      "Seatbelt containment supersedes workspace authority for safe R0 reads"
  - The downstream tests pin CURRENT behavior (outside -> ASK) but do not
    pin it as DESIRED policy
```

## 3. The load-bearing finding

The Seatbelt SBPL read rule is BROAD ALLOW + SMALL DENY-LIST:

```sbpl
  (allow file-read*)
  (deny file-read* (subpath "<curated>"))
```

The deny-list is populated by `resolveSafeYoloSensitiveReadDenials` (`apps/vscode/src/sdk/sandbox-policy.ts:656-734`). It returns the **CURATED_CREDENTIAL_SET_V1** (the seven `~/.ssh/id_*` keys + `~/.gnupg/private-keys-v1.d/`), and only when ALL of the following are satisfied:

```text
  resolveExperimentalSandboxMode() === "seatbelt-experimental"
  effective network capability is "allow"
  process.env.HOME is set
```

When the network opt-in is NOT set (the default posture), `denyReadSubpaths = []`. The R11 test in `darwin-seatbelt-safe-yolo-sensitive-read-confinement01.c2-green.test.ts:455-462` is explicit on this contract: Seatbelt ON + network DENY -> denyReadSubpaths = [].

Therefore: under the default posture, Seatbelt permits reading **any** host file the macOS filesystem permits the process user to read. This includes `/etc/passwd`, `~/.aws/credentials`, `~/.ssh/config`, `~/.bash_history`, and the live 54T24A8CE5 operand `/etc/profiles/per-user/chistyakov/bin/codium-clinemm`.

## 4. The privacy implication

Sandboxed execution (process containment) is NOT the same as "safe to expose host file contents to the model". A process can be safely contained (cannot write outside writableRoots, cannot exfiltrate to network under default-deny) while still being permitted to read any host file the macOS filesystem allows the process user to read.

When such a file contents are emitted (via `cat`, `wc -l`, `head`, or any safe R0 read command), they enter the model context. This is data exfiltration by content, not by network.

ClineMM `host_workspace_realpath_authority` may therefore be intended as a **data-authority boundary** (the model should never see host file contents that live outside the workspace) rather than a **substitute for sandbox containment** (a convenience gate that pre-dates Seatbelt and is now redundant).

The source tree does not adjudicate between these two interpretations. The answer is a product-policy question.

## 5. Verdict

```text
POLICY_INTENT_FOR_OUTSIDE_READS_UNDER_ALL_SEATBELT = UNDOCUMENTED_OR_AMBIGUOUS_IN_SOURCE

CAPTURE_INSUFFICIENT_RE_POLICY = TRUE
  (not because we lack data; because we lack authoritative product doctrine)

54T24A8CE5_CLASSIFICATION = NOT_A_DEFECT_UNTIL_POLICY_DECISION_LANDS
  (current ASK is policy-expected under the prevailing tests; the question
   is whether the policy is itself correct)

R5_MANUAL_APPROVAL_LANE = STILL OPEN
  (the live specimen does NOT prove a defect; the policy question is now
   explicitly framed for operator / product-owner decision)
```

## 6. Operator / product-owner decision rule

The decision belongs to the operator / product owner. The recon produces the source-tree evidence and the adversarial-case inventory. The choice is:

```text
NOT_A_DEFECT_POLICY_EXPECTED
  if outside reads intentionally require approval under ALL+Seatbelt.
  54T24A8CE5 closes as EXPECTED. R5 manual-approval lane waits for
  a genuinely incorrect specimen. NO PRODUCTION CHANGE.

POLICY_SEMANTICS_DEFECT
  if product doctrine establishes that ALL+mandatory Seatbelt SHOULD
  suppress approval for outside reads AND the privacy invariants in
  source-seam-map §3.6 / adversarial-case-inventory.md §2-§7 can be
  preserved. Then a separate REPAIR01 is authorized with the explicit
  goal of defining the precise allowed class (per-command, per-privacy-class)
  and proving Seatbelt provides the required protection.

CAPTURE_INSUFFICIENT
  if product intent is genuinely undocumented/ambiguous.
  Stop and require explicit policy decision. NO PRODUCTION CHANGE.
```

## 7. Forbidden (this ACT and any successor)

```text
  - Do not implement "ALL means everything, always allow."
  - Do not globally bypass host_workspace_realpath_authority.
  - Do not use the cardinality fix as evidence for policy intent.
  - Do not equate read-only with harmless.
  - Do not equate Seatbelt process containment with permission to expose
    host file contents to the model.
  - No Idle work.
  - No R0 reopening (this ACT is not a R0 defect; see safe-yolo-seatbelt.md §15).
```

## 8. STOP conditions

```text
  - This ACT stops here. The decision belongs to the operator / product owner.
  - No new v2 capture probe.
  - No new RED.
  - No production repair.
  - Do not enter another review round unless a NEW P0 appears.
  - Do not bundle with CORRECTION02; they are separate lanes.
```

## 9. ACT closure

```text
STATUS                 = RECON_COMPLETE / NO_REPAIR / NO_RED
BOUNDARY               = policy/contract reconciliation, not repair
SOURCE_SEAM_MAP        = ACT evidence directory / source-seam-map.md
ADVERSARIAL_INVENTORY  = ACT evidence directory / adversarial-case-inventory.md
DECISION_PENDING       = operator / product owner
54T24A8CE5_CLASS       = NOT_A_DEFECT_UNTIL_POLICY_DECISION_LANDS
R5_LANE                = STILL OPEN (separate from this ACT)
CORRECTION02_LANE      = CLOSED (no impact)
PRODUCTION_DELTA       = NONE
FACTORY_BOARD_DELTA    = epic-board.md + safe-yolo-seatbelt.md updated
```

