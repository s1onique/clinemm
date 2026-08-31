# Verdict record — ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01

```text
ACT_ID              = ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01
REVIEWERS           = Product-security architect + Factory reviewer
DATE_RECORDED       = 2026-08-31
PRE-VERDICT (ACT)   = POLICY_INTENT_FOR_OUTSIDE_READS_UNDER_ALL_SEATBELT =
                      UNDOCUMENTED_OR_AMBIGUOUS_IN_SOURCE
                    + 54T24A8CE5_CLASS = NOT_A_DEFECT_UNTIL_POLICY_DECISION_LANDS
DECISION            = NOT_A_DEFECT_POLICY_EXPECTED
POLICY              = WORKSPACE_IS_DATA_AUTHORITY_BOUNDARY
54T24A8CE5          = CLOSED_EXPECTED
PRODUCTION_CHANGE   = NONE
R5_MANUAL_APPROVAL  = OPEN, awaiting genuinely erroneous specimen
C1_VERDICT          = GO  (no outside-read REPAIR01)
```

---

## The chosen policy

```text
WORKSPACE_IS_DATA_AUTHORITY_BOUNDARY

  Workspace realpath authority (host_workspace_realpath_authority) is
  a DATA-AUTHORITY boundary, not merely a pre-Seatbelt containment
  mechanism.

  Seatbelt           controls what the child PROCESS may do.
  Workspace authority controls what DATA the AGENT may consume
                      without asking.

  These are distinct security properties.
```

## The chosen definition of `ALL`

```text
ALL =
  Auto-approve every operation that has already satisfied the applicable
  security/data-authority constraints.

NOT:
  Bypass all authorization boundaries.

Operational consequence:
  explicit DENY              still wins
  stale authority evidence   still fails closed
  risk hard floor            still wins
  outside data authority     still asks
  mandatory Seatbelt         controls execution after ALLOW
```

## `54T24A8CE5` — CLOSED_EXPECTED

The outside operand was benign (`/etc/profiles/per-user/chistyakov/bin/codium-clinemm`).
But the policy cannot safely distinguish benign by inspecting file
content — the same primitive can target `~/.aws/credentials`,
`~/.kube/config`, `~/.netrc`, `~/.git-credentials`, shell-history files,
arbitrary mounted volumes, etc. The manual prompt was correct; the
live ASK is the policy working as intended.

Full inventory in `adversarial-case-inventory.md` §2.

## NEXT_R5_TRIGGER (sharp definition)

A genuinely erroneous R5 specimen must satisfy ALL of:

```text
  resolvedMode          = all
  mandatorySeatbelt     = true

  AND

  all path-bearing operands INSIDE authorized workspace roots
  (or no path authority is relevant)

  AND

  no explicit deny rule matches
  no risk hard floor
  no stale/missing evidence

  BUT

  finalDecision         = ask
  approval UI published
```

After `f56e87af0` lands, dogfood should now be watching for:

> an unexpected prompt on a fully-authorized, all-inside request.

## Out of scope (recorded, NOT acted on)

### P2 UX-copy residue (separate product-copy item)

```text
  Current:    "Auto-approve: ⚡ ALL — this task"
  Suggests:   "I will never be asked."
  Reality:    "ALL eligible operations, subject to security/
              data-authority gates."

  Suggested:  "Auto-approve: ALL safe operations"
  or shorter: "Auto-approve: ALL*"
  with explanation:
    "Operations crossing workspace, security, or explicit-deny
     boundaries can still require approval."
```

This is a P2 product-copy/usability item. NOT part of this R5 lane.
NOT introduced by any production change here.

### P2 hygiene residue (pre-existing, outside epic scope)

Per operator: "None should block execution under our policy."

```text
  - git diff --check: four blank lines at EOF
  - gate-summary:     stale/invalid schema
  - Leamas:           generator/subject identity warning
```

These are pre-existing P2 hygiene items outside the scope of this ACT
and the safe-yolo-seatbelt epic.

## Verbatim sources cited by the operator (recorded for completeness)

```text
  [1] anthropic-experimental/sandbox-runtime
      https://github.com/anthropic-experimental/sandbox-runtime
      Upstream default read model: "allow everywhere unless denied".
      Doc recommends denying broad host regions and selectively
      re-allowing the workspace when filesystem confidentiality matters.

  [2] cline/cline/docs/sdk/guides/permission-handling.mdx
      https://github.com/cline/cline/blob/main/docs/sdk/guides/permission-handling.mdx
      Upstream autoApprove baseline: "run without asking" + separate
      command-permission restrictions; warns "auto approve everything"
      only in fully trusted or sufficiently sandboxed environment.
```

These corroborate the policy semantics but are NOT proof of ClineMM
intent; ClineMM is intentionally stronger than the upstream default.

## Cross-references

```text
  ACT body        .factory/acts/ACT-CLINEMM-SEATBELT-ALL-OUTSIDE-READ-POLICY-RECON01.md
                  (§13 operator verdict, §14 closure summary)
  Source seam     .factory/evidence/.../source-seam-map.md
  Adversarial     .factory/evidence/.../adversarial-case-inventory.md
  Final report    .factory/evidence/.../final-report.md
  Epic detail     .factory/epics/safe-yolo-seatbelt.md
  Board row 25    .factory/epic-board.md (Approval / outside-read under
                  ALL+Seatbelt policy reconciliation)
  Predecessor     ACT-CLINEMM-SEATBELT-ALL-WORKSPACE-REALPATH-AUTHORITY-CORRECTION02
                  (CLOSED REPAIRED; 54T24A8CE5 not bound; CARDINALITY_REPAIR kept)
  Sibling recon   ACT-CLINEMM-SEATBELT-ALL-R0-EXECUTION-OBLIGATION-RECON01
                  (still OPEN; separate lane; not bundled)
```