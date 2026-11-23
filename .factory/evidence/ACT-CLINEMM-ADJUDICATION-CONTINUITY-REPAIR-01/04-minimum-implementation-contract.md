# 04 — Minimum implementation contract (NOT EXECUTED)

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**Status:** **NOT EXECUTED.** G3 is conditional on `GO_BOUNDED_IMPLEMENTATION`;
the G2 trust gate returned `HALT_TRUST_BOUNDARY_UNRESOLVED`.

---

## 1. Why this file exists anyway

G2.4 requires that a halt "**Preserve the RED and the feasibility
findings.**" and G11's `HALT_SCOPE_EXPANSION` requires that the "minimum new
contract" be documented. This file records the contract that **would** apply
to any successor implementation, so that a future ACT does not have to
re-derive it and so that no reader mistakes the absence of a production
change for an oversight.

**Nothing in this file was implemented. No production file was touched.**

---

## 2. The contract

```
INPUT_AUTHORITY
  Model-authored assistant TEXT block. Never a system/developer instruction,
  never raw thinking, never tool output promoted to a verdict.

ELIGIBILITY_RULE
  The carrier message must contain a verdict token AND a qualification token,
  AND must carry a tool_use whose matching tool_result exists in the
  canonical record. A bare verdict keyword is NOT eligible. A verdict
  keyword appearing in tool output is NOT eligible. A verdict keyword in
  ordinary source code (e.g. @Column(name = "CONFIRMED")) is NOT eligible.

EVIDENCE_BINDING
  By REFERENCE ONLY — the paired tool_use id. Never a copy of the source
  content, never an excerpt of the source file, never the raw tool stdout.

OUTPUT_REPRESENTATION
  Visibly MODEL-DERIVED and QUALIFIED. It must be structurally distinct
  from (a) the task contract, which carries the ALLEGATION, and (b) the
  canonical tool-result record, which carries the EVIDENCE. It must not read
  as an authoritative fact.

CONFIDENTIALITY_BOUNDARY
  Refusal-to-promote, never copy-and-sanitize. A carrier that looks
  credential-bearing or that names a credential-bearing path (production
  isSensitiveSourceFilePath) is REFUSED, not rewritten. A finite denylist
  does NOT prove arbitrary-content confidentiality and must never be
  presented as such.

REVISION_FRESHNESS_RULE
  The carrier must name its source revision, or the representation must
  carry an explicit "revision unverified" marker. A stale adjudication must
  NOT override newer evidence. If no revision identity is available, the
  adjudication must be marked UNRESOLVED rather than assumed fresh.

TOKEN_BUDGET
  A finite, explicit carry budget, validated against the existing compaction
  token budget — not assumed harmless because the text is short. A protected
  user instruction must NEVER be silently discarded to make room for an
  adjudication. If the required evidence cannot fit, the outcome is
  ADJUDICATION_NOT_SAFELY_CARRIED — never a false preservation claim.

PERSISTENCE_SEMANTICS
  No new persistence service. No cross-session state. No sidecar schema
  migration. Reuse the existing compaction summary/carry-forward seam.

NO_OP_SEMANTICS
  Zero additional model calls on the no-op path. No new provider-facing
  role. No new tool schema. No change to the canonical history. No mutation
  of canonical thinking blocks.
```

---

## 3. The historical-witness limitation, stated against this contract

Applying the contract to the measured historical record:

| Field | R8 / R7 / R3 (measured) | Contract satisfiable? |
|---|---|---|
| `INPUT_AUTHORITY` | the carrier would have to be the `thinking` block | **NO** — reading it is reading private reasoning prose |
| `ELIGIBILITY_RULE` | no `text` block exists; no verdict token is reachable from an authorized carrier | **NO** |
| `EVIDENCE_BINDING` | the paired `tool_result` exists (idx 29 / 41 / 65) | YES, but it grounds the EVIDENCE, not the ADJUDICATION |
| `OUTPUT_REPRESENTATION` | would have to be derived from prose | **NO** |
| `CONFIDENTIALITY_BOUNDARY` | the thinking block also carries unrelated reasoning and severity speculation | **NO** — S1's measured leak |
| `REVISION_FRESHNESS_RULE` | the carrier names no revision | **NO** — freshness is UNRESOLVED |

**Six of seven fields are unsatisfiable for the historical witnesses.** This
is the formal statement of the halt.

---

## 4. The four excluded implementation routes (G4)

These were NOT taken, and the probe records why each is not available:

```
dropThinkingBlocks=false for agentic_summary   -> S1. Measured disclosure leak.
raw reasoning forwarding                        -> S1. Prohibited by the ACT.
automatic raw source-file excerpts              -> Prohibited; the flag stays false.
arbitrary command stdout forwarding             -> Prohibited; the historical
                                                    tool_result already renders
                                                    as "[result omitted]".
```

Additionally NOT done, as required:

```
regex-only secret safety claims                 -> The probe refuses to promote;
                                                    it does not claim a sanitizer.
generic memory/knowledge graph                  -> Not created.
new public protocol field without authorization  -> Not created.
unbounded verdict history                       -> Not created.
new model request in no-op preparation          -> Not created (no-op path untouched).
```

---

## 5. Conservation invariants — unchanged by this ACT

Because no production file was touched, every G7 invariant holds **trivially
and verifiably**:

| Invariant | Requirement | Observed |
|---|---|---|
| `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED` | remains `false` | `false` (asserted by the discriminator) |
| `MAX_CARRIED_OUTCOMES` | remains `12` | `12` (asserted by the discriminator) |
| Canonical history | byte-identical | unchanged; asserted by the discriminator |
| Tool-use/result pairing | preserved | asserted by the discriminator |
| Sidecar schema | unchanged | no production change |
| Task contract | unchanged | no production change |
| Provider tool schemas | unchanged | no production change |
| No-op preparation | zero additional model calls | no production change |
| Stable prefix | no unnecessary earlier-message changes | no production change |
| Provider input budget | enforced | no production change |
| Session isolation | preserved | no production change |
| Source revisions | stale adjudications cannot override current evidence | no carried adjudication exists |
| Disabled diagnostics | no runtime-semantic delta | no production change |
| React functional updaters | no diagnostic side effects | no production change |
