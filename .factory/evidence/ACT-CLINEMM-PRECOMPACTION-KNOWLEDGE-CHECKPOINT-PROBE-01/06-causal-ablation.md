# 06 — Causal ablation

**Evidence class:** `SYNTHETIC_REAL` (cases A/C/D, real production seam) and `REAL`
(the historical control, frozen captures).

---

## 6.1 The four cases with identical historical input and boundary identity

| Case | Checkpoint | Compaction projection | Evidence class |
|---|---|---|---|
| **A** | None | Recorded control | `SYNTHETIC_REAL` (seam) + `REAL` (frozen capture) |
| **B** | Model-generated, validated | Treatment | `REAL_MODEL_RESPONSE` |
| **C** | **SYNTHETIC** oracle, controlled | Diagnostic positive control | `SYNTHETIC` |
| **D** | Treatment removed | Ablation | `SYNTHETIC_REAL` |

Every case runs the SAME historical input through the SAME production seam, with the
same boundary identity. Only the checkpoint differs.

---

## 6.2 The six required causal checks (G5)

### Check 1 — The checkpoint source contains the pre-compaction observation

**PARTIAL / FAIL for the exact tokens; PASS for the subjects.**

The checkpoint SOURCE (the controlled input view) contains the R4/R6/R2 **subjects**
(they appear in the assistant's public text and reasoning-derived text) but NOT the exact
operational tokens:

| Token | In the controlled input? | Measured |
|---|---|---|
| `start --optimized` | **NO** | false |
| `No delete/purge found in those paths` | **NO** | false |
| `MtsOmni` | **NO** | false |
| `kc.sh build` | yes | true |

Root cause: the production `renderStructuredToolPayload()` renders the structured
`{query, result, success}` payload as `[succeeded] #1: [result omitted]`, and the
`agentic_summary` budget policy drops thinking blocks. Both are existing, deliberate
contracts (`01-production-seam-map.md` §1.5).

### Check 2 — The model either extracts it or demonstrably fails to

**The model demonstrably reported the failure, rather than failing silently.**

It published *"the available tool-result bodies are omitted"* (boundary 1) and *"Most
successful tool-result bodies are rendered as omitted in the supplied transcript"*
(boundary 2), and it refused to certify any of R1–R10. It extracted everything it could
legitimately see: **13 records** at boundary 1 and **20 records** at boundary 2.

**PASS.**

### Check 3 — A validated checkpoint represents the qualification accurately

**PASS.**

The projected section carries, for the oracle:

```text
r4-startup: ... qualifications=Observed command pair only; configuration drift remains unproven. ...
r6-retention: ... qualifications=Bounded to the inspected paths; an external purge is not excluded. ...
```

and for the model treatment, the published qualifications are preserved verbatim
(e.g. *"Repository absence searches are bounded and do not prove that no database job,
external scheduler, or operational purge process exists."*).

The validator independently enforces this: an over-claimed record is DROPPED, not
quietly qualified (`checkpoint-security-controls.test.ts` cases `G5.1.2`, `G5.1.3`,
`G5.1.1`).

### Check 4 — The treatment makes the information available after compaction

**PASS, at subject level.**

| | Control (A) | Treatment (B/C) |
|---|---|---|
| R4 subject after compaction | topic only | subject + qualification |
| R6 subject after compaction | topic only (boundary 1) | subject + qualification (boundary 1) |
| R2 subject after compaction | topic only | subject + qualification |

### Check 5 — Removing the treatment restores its absence

**PASS.** Case D is the direct ablation: with the checkpoint the provider-visible text
contains `start --optimized`; without it, it does not.

### Check 6 — No unrelated higher-priority instructions or task obligations change

**PASS.**

- The task-contract section is byte-identical with and without the checkpoint.
- The verified-outcome section is byte-identical with and without the checkpoint.
- The message count is unchanged.
- The canonical history is byte-identical.
- The checkpoint section is added **after** the task contract and the verified-outcome
  section, so it cannot displace them.
- Exactly one compaction summary exists.

---

## 6.3 The negative controls (G5.1) — all PASS

| Negative control | Result | Mechanism |
|---|---|---|
| R2's planned investigation is not promoted into a completed finding | ✅ | `UNRESOLVED_INVESTIGATION_PROMOTED` gate; the model itself published R2 as `unresolved`/`unverified` |
| R6's limited negative is not promoted into global nonexistence | ✅ | `GLOBAL_NEGATION_OVERCLAIM` gate; the model published R6 as `unresolved` with a bounding qualification |
| R4's startup commands are not promoted into proven deployment drift | ✅ | `UNPROVEN_CAUSALITY_OVERCLAIM` gate; the model published R4 as `unresolved` with *"An intentional startup build can be operationally valid"* |
| Original user allegations are not treated as independent evidence | ✅ | the model's `obs-004`/`r1-010`..`r10-019` records carry `model_reported`/`unverified` and explicit "frozen claims" qualifications |
| Contradictory newer observations are not silently discarded | ✅ | binding preserves BOTH records with their lifecycle `status` (`superseded` + `active`); the checkpoint does not adjudicate between them |
| A missing evidence reference does not become a fabricated reference | ✅ | `EVIDENCE_REF_UNRESOLVED` drops the reference; a fabricated one is never substituted |
| Untrusted tool-output instructions remain data | ✅ | `INSTRUCTION_SHAPED_TEXT` gate drops the record entirely |
| Credential-bearing or unrestricted free-text output is not forwarded as a trusted fact | ✅ | `CREDENTIAL_SHAPED_TEXT` gate drops the record (not redacted) |
| A malformed or absent checkpoint does not destroy the original compaction path | ✅ | the parser is total; the compaction still runs and is still provider-visible |

### A note on the "contradictory newer observations" control

This control is worth stating precisely, because it is easy to get wrong. The
checkpoint does NOT resolve contradictions. It preserves both records with their
`status`, and lets the continuing agent see that one is `superseded`. That is the
correct division of labour: the checkpoint is a carrier, not an adjudicator. (The
production adjudication framework already exists for adjudication; this ACT deliberately
did not generalize it.)

---

## 6.4 What the ablation does NOT prove

Per the ACT's own discipline, and stated here rather than implied:

- **It does not prove behavioral improvement.** Whether a continuing agent *uses* the
  preserved knowledge to avoid reinvestigation is `NOT_EXECUTED` — no separately
  controlled continuation was run.
- **It does not prove that the model-authored checkpoint would restore the exact
  tokens.** It demonstrably could not, because those tokens were never in its input.
- **It does not prove the checkpoint is worth 66–81 seconds.** That cost is measured; its
  value is not established.
