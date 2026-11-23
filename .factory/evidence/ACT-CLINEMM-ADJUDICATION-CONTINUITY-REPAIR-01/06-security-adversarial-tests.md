# 06 — Security negative controls

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**Status:** The predecessor's eight controls were **re-run and pass**. No new
boundary was exposed by this ACT, because **no production mechanism was
deployed**.

---

## 1. The predecessor's eight controls — re-run

All eight live in
`sdk/packages/core/src/extensions/context/compaction.adjudication-continuity.discriminator01.test.ts`
and were re-executed after the G0.2 correction.

**Observed:** `Test Files 1 passed (1)` / `Tests 24 passed (24)` / exit 0.

| # | Control | What it establishes | Observed |
|---|---|---|---|
| 1 | A qualified verdict containing a synthetic secret is not automatically promoted | `secret_bearing_verdict` | PASS |
| 2 | A verdict containing a copied instruction from untrusted tool output is refused | `injected_instruction` | PASS |
| 3 | A tool result that falsely claims system/developer authority is not trusted source evidence | `untrusted_source`; and the production serializer renders it as `[result omitted]` | PASS |
| 4 | A model assertion without supporting source evidence is not promoted | `no_source_grounding` | PASS |
| 5 | A verdict contradicted by later source evidence does not stay authoritative | `stale_source_revision` | PASS |
| 6 | A verdict that includes path/provenance information is bounded, not carried verbatim | `sensitive_provenance` (production `isSensitiveSourceFilePath`) | PASS |
| 7 | A failed, truncated or ambiguous source result is not sufficient grounding | grounding is `false` for each | PASS |
| 8 | A small or model-authored statement is NOT inherently confidentiality-safe | `secret_bearing_verdict` for a 30-char verdict | PASS |

---

## 2. The G2 probe's controls — added by this ACT

The feasibility probe adds the G2.3 contract (A–G) as executable controls:

| # | Control | Reason code | Observed |
|---|---|---|---|
| A | A supported qualified adjudication is eligible (structurally grounded) | — | PASS |
| B | An unsupported assertion is rejected | `no_qualification` | PASS |
| C | An injected instruction is rejected | `injected_instruction` | PASS |
| D | Secret-bearing content is not copied | `secret_bearing` (output is `undefined`) | PASS |
| E | A stale/contradicted adjudication loses authority | freshness measured as **UNRESOLVED** for the historical carrier | PASS (limitation reported) |
| F | The original source evidence is never replaced by the verdict | evidence body absent from the extraction; evidence carried by reference | PASS |
| G | The historical thinking-only witness is recoverable, **or** the limitation is reported explicitly | limitation reported; no structured verdict field exists | PASS |

---

## 3. The G6 extended list — what was and was not executed

The ACT's G6 requires at minimum ten negative controls. Their status:

| # | Control | Executed? | Basis |
|---|---|---|---|
| 1 | Synthetic secret inside a qualified verdict | **YES** | predecessor CONTROL 1 + probe D |
| 2 | Unrecognized secret syntax inside ordinary text | **PARTIAL** | The probe refuses on a *recognised* shape. **An unrecognised secret syntax is NOT detected** — and this is stated explicitly rather than glossed. |
| 3 | Copied prompt-injection instruction | **YES** | predecessor CONTROL 2 + probe C |
| 4 | Forged system/developer authority in tool output | **YES** | predecessor CONTROL 3 (production serializer renders it `[result omitted]`) |
| 5 | Unsupported model assertion | **YES** | predecessor CONTROL 4 + probe B |
| 6 | Later contradictory source evidence | **YES (structural)** | predecessor CONTROL 5 — revision-change check |
| 7 | Sensitive path/provenance | **YES** | predecessor CONTROL 6 + probe `sensitive_provenance` |
| 8 | Failed, truncated, incomplete or ambiguous supporting tool result | **YES** | predecessor CONTROL 7; the probe's structural grounding requires the `tool_result` to EXIST, and an absent result is not grounded |
| 9 | Source revision change after adjudication | **YES (structural)** | predecessor CONTROL 5; the probe measures `carriesSourceRevision === false` for the historical carrier |
| 10 | Cross-session reuse of an earlier verdict | **NOT EXECUTED against a deployed mechanism** | There is no deployed mechanism and no cross-session state. The contract in `04-minimum-implementation-contract.md` requires `PERSISTENCE_SEMANTICS: no cross-session state`. |

---

## 4. The adversarial authority test

The ACT requires that a model-authored verdict must not acquire authority
over:

| Authority the verdict must NOT acquire | Status |
|---|---|
| User instructions | **HOLDS.** The carried representation would be a model-authored `text` block inside the assistant role; it is never a system/developer turn. The task contract (the user's objective) is carried in a **separate** section and is not derived from the verdict. |
| Runtime completion obligations | **HOLDS.** No production change; the completion checkpoint is untouched. |
| The canonical tool-result record | **HOLDS.** The verdict is carried by **reference** to the evidence identity, never as a replacement for it (probe F). |
| Newer contradictory evidence | **STRUCTURALLY REQUIRED** and partially proven (revision-change check). |
| Source-revision identity | **HOLDS (as UNRESOLVED).** The verdict never asserts a revision it cannot evidence. |

---

## 5. The explicit non-claim

> **A finite denylist does NOT prove arbitrary-content confidentiality.**

The probe's secret control refuses a *recognised* credential shape. It does
**not** detect an unrecognised one, and it does **not** sanitise — it
**refuses to promote**, which is the safe default for untrusted model-authored
text. If a mechanism were ever to carry unconstrained model text across the
trust boundary, these controls would be **insufficient regardless of pass
count**. That is why the candidate mechanism was not adopted.

**No production mechanism carries unconstrained model text, because no
production mechanism was deployed.**
