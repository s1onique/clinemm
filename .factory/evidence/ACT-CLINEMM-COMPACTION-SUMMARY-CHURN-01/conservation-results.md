# ACT-CLINEMM-COMPACTION-SUMMARY-CHURN-01 — Conservation Results

The ablation is DIAGNOSTIC ONLY. This document records exactly which
guarantees are LOST when a transformation is disabled, and which are
conserved.

---

## 1. What the 2×2 ablation actually switches

The switches exist ONLY in the disposable offline probe
(`tool/probe.ts`) and in the disposable test helper. They are applied
OUTSIDE the production functions: when a switch is OFF, that production
function is simply **not invoked**. They are NOT production feature flags,
NOT public API, and NOT exported from any package barrel.

| Variant | Task contract | Verified evidence |
|---|---|---|
| A — Original projection | OFF | OFF |
| B — Contract only | ON | OFF |
| C — Evidence only | OFF | ON |
| D — Production composition | ON | ON |

---

## 2. The ablation result (from `ablation-matrix.json`)

Measured on the REAL sidecar and the REAL canonical transcript, with the
REAL production functions.

| Variant | H0→H1 changed | H1→H2 changed | rewritten on each continuation | first changed part | provider-visible common prefix H0→H1 |
|---|---|---|---|---|---:|
| **A** contract OFF, evidence OFF | **no** | **no** | no | none | 14,699 |
| **B** contract ON, evidence OFF | **no** | **no** | no | none | 14,740 |
| **C** contract OFF, evidence ON | **yes** | **yes** | **yes** | `compaction_summary` text part | 13,979 |
| **D** contract ON, evidence ON | **yes** | **yes** | **yes** | `compaction_summary` text part | 14,020 |

`sidecarUnmodified: true` for the whole matrix.

### Necessity discriminator — the ACT's four conditions

| # | Condition | Result |
|---|---|---|
| 1 | The production composition reproduces churn | **MET** — variant D changes on both transitions |
| 2 | Removing evidence restoration eliminates the relevant mutation | **MET** — variant B (contract ON, evidence OFF) does NOT change |
| 3 | Re-enabling evidence restoration restores that mutation under equivalent inputs | **MET** — variant C (same inputs, evidence ON) DOES change |
| 4 | Contract-only behavior does not independently cause the same observed mutation | **MET** — variant B is byte-stable across the same append-only continuations |

**Evidence restoration is a NECESSARY contributor. Task-contract
restoration is NOT independently responsible.**

---

## 3. Canonical evidence — conserved

Verified by `sdk/packages/core/src/extensions/context/compaction.summary-churn01.test.ts`.

| Guarantee | Test | Result |
|---|---|---|
| Canonical transcript byte identity before/after the projection | "leaves the canonical transcript byte-identical after the projection" | **PASS** |
| Verified tool-call/result pairing enforced | "does not promote a call with NO result" | **PASS** |
| No fabricated successful outcomes | "does not promote a FAILED outcome into the carried section" | **PASS** |
| No duplicate carried outcomes | "does not duplicate a carried outcome across repeated preparations" | **PASS** |
| Rejected / ambiguous outcomes not promoted | already covered by the 62-test `evidence-continuity.test.ts`; unchanged | **PASS** |
| Correct last-12-outcome selection | "keeps the rolling 12-outcome selection and drops the OLDEST outcome" | **PASS** |
| Canonical ordering | the ledger sorts by `sourceIndex`; unchanged | **PASS** |
| Correct replacement of the previous evidence section | "does not duplicate a carried outcome across repeated preparations" (the section is REPLACED, not accumulated) | **PASS** |
| No delimiter spoofing | "does not let a carried excerpt spoof the section delimiter" + "escapes a delimiter that reaches a carried subject" | **PASS** |
| Preservation of verified command-count semantics | "preserves the verified command-count semantics" (3 commands → `3 commands`) | **PASS** |

**Note on the delimiter guarantee.** The test revealed a STRONGER property
than the ACT assumed: the carried subject is a CLASSIFICATION drawn from
the finite `COMMAND_CLASSIFICATION_ALLOWLIST`, never the user's raw command
text. A raw delimiter in a command therefore cannot reach the section at
all. The `escapeDelimiters()` helper (`evidence-continuity.ts:1171`) is the
last line of defence behind that.

---

## 4. Task contract — conserved

| Guarantee | Test | Result |
|---|---|---|
| Task objective retained | "preserves the task objective and the completion obligation across the carry-forward" | **PASS** |
| Original constraints retained | same test (`Do not add replacement findings.`) | **PASS** |
| Completion obligations retained | same test + the runtime-obligation carry is unchanged in production | **PASS** |
| Budget guard remains fail-closed | unchanged in production (`task-contract.ts:503-514` throws `TaskContractBudgetError` before persistence or dispatch); covered by `task-contract-budget-authority.test.ts`, which passes unchanged | **PASS** |
| No silent omission of the contract on overflow | unchanged in production; same suite passes | **PASS** |

---

## 5. Sidecar and resume — conserved

| Guarantee | Test | Result |
|---|---|---|
| Stored source-prefix hash remains valid | `projectSessionCompactionState()` succeeded against the real sidecar; the corruption negative control shows it is ENFORCED | **PASS** |
| Source message count and boundary identity conserved | sidecar `source_message_count = 73` unchanged; `sidecarUnmodified: true` | **PASS** |
| Sidecar not modified by projection-only analysis | "leaves the persisted sidecar unmodified by a projection-only analysis" | **PASS** |
| Appended canonical tail included exactly once | "includes the appended canonical tail exactly once" | **PASS** |
| Summary metadata and visible text remain consistent | `rebuildSummaryMessage()` (`evidence-continuity.ts:1322`) updates BOTH `content` and `metadata.summary` together; unchanged in production | **PASS** |
| Corrupted sidecar identities rejected | "rejects a corrupted sidecar identity instead of projecting it" | **PASS** |
| No mutation of canonical state | "leaves the canonical transcript byte-identical after the projection" | **PASS** |

---

## 6. Provider-facing behaviour — conserved

| Guarantee | Evidence | Result |
|---|---|---|
| System prompt unchanged | live captures: `systemFingerprintStable: true` on every transition | **PASS** |
| Tool schemas and ordering unchanged | live captures: `toolInventoryStable: true` on every transition | **PASS** |
| Tool-call/result correlation conserved | production code unchanged; `evidence-continuity.test.ts` (62 tests) passes unchanged | **PASS** |
| No provider request issued during the offline ablation | the probe never constructs a transport; `MessageBuilder.buildForApi()` only transforms messages | **PASS** |
| No new public request field | the probe adds none; the only production-facing change in this ACT is the vitest `exclude` entry and a package script | **PASS** |
| No changed production serialization | `sdk/packages/core/src/**` production source is byte-identical to the entry HEAD | **PASS** |

---

## 7. What is LOST when evidence restoration is disabled (variant B)

This is the cost of the ablation. It is DIAGNOSTIC, not a proposal.

| Guarantee lost when the evidence carry-forward is OFF | Consequence |
|---|---|
| A successful execution that the generated summary dropped is no longer present in the model-facing context | The continuing model can report a verified success as `NOT_EXECUTED` — the exact defect ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01 was created to fix |
| The canonical record of what actually executed is no longer authoritative in front of the model | The summary becomes MORE authoritative than the canonical transcript, violating the invariant *"a generated summary must NOT become MORE AUTHORITATIVE than the canonical record of what actually executed"* |
| The rolling 12-outcome record is not refreshed as new outcomes arrive | The model loses the most recent verified outcomes after a compaction |

**This is why the successor ACT must preserve evidence, ordering, task
obligations, resume correctness and budget safety while making the
provider-facing prefix stable. The repair is NOT "remove the carry-forward".**

### What is NOT lost

The task contract (objective, later user instructions, runtime completion
obligation), the canonical transcript, the sidecar, the budget guard and
the provider serialization are all unchanged by the ablation. The cost is
confined to the verified-evidence continuity guarantee.
