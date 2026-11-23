# 10 — Exit report

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**VERDICT:** **`HALT_TRUST_BOUNDARY_UNRESOLVED`**

---

## 1. The one-sentence answer

> **The compaction adjudication-continuity defect at M1 is real and remains
> RED, but its historical witnesses (R3, R7, R8) exist ONLY inside
> free-form private reasoning prose with no structured field boundary —
> therefore every mechanism that would recover them requires reading
> arbitrary private reasoning, which is exactly the ACT's stated
> trust-gate failure condition; no bounded, safe repair exists within the
> authorized candidate set, so the repair is withheld and the RED is
> preserved, unweakened and isolated.**

---

## 2. What this ACT established

### 2.1 New, decisive facts (all executable or directly measured)

| # | Finding | Label |
|---|---|---|
| F1 | All four historical witnesses (canonical idx 28, 40, 64, 124) have block shape `[thinking, tool_use]` and **no `text` block**. | REAL (frozen canonical snapshot, sha256 `9ca5309a…`, exact match to the ACT-specified value) |
| F2 | Each of the three adjudication phrases occurs in **exactly one place** in the entire 196-message record: a `thinking` block. | REAL |
| F3 | The only textual `CONFIRMED`/`NARROWED` outside thinking blocks are the **user's task-prompt rubric** (the allegation) and **Java source code** `@Column(name = "CONFIRMED")` in tool output — lexical noise. | REAL |
| F4 | Across **all 97 thinking blocks** there are **zero** labelled verdict fields (`verdict:`, `finding:`, `decision:`, `evidence:`, `qualification:`); the three witnesses contain **no** JSON block and **no** markdown heading. | REAL |
| F5 | S1 (raw thinking) delivers the verdict **and** leaks the model's unrelated private reasoning **and** its speculative severity numbers. | REAL_PRODUCTION_SEAM |
| F6 | The assistant-`text` carrier carries **no** qualified decision for the historical witness (extraction → `no_verdict_token`). | REAL_PRODUCTION_SEAM |
| F7 | The `tool_result` carrier carries the **evidence**, not the **adjudication** (extraction → `no_verdict_token`), and it is the carrier that can contain copied untrusted instructions. | REAL_PRODUCTION_SEAM |
| F8 | Reading the thinking carrier **would** recover the verdict, but only by **searching free-form private reasoning prose**. | REAL_PRODUCTION_SEAM |
| F9 | The historical carrier carries **no source revision**, so freshness is **UNRESOLVED** and cannot be assumed. | REAL_PRODUCTION_SEAM |
| F10 | The predecessor's ablation helper inserted the adjudication into **two** messages, not one. | REAL (committed predecessor source) |

### 2.2 The decision

The three ACT constraints intersect exactly on F1, F2, F4 and F8:

- G2.2 rejects S1 for automatic deployment (unbounded disclosure surface).
- G2.1 warns that an alternative carrying assistant text but not recovering
  these witnesses is **not** a complete historical repair.
- G2.3 states: *"If eligibility requires inspecting arbitrary private
  reasoning … the trust gate fails."*

Therefore **no candidate in the authorized set can recover the historical
witnesses without failing the trust gate**, and **no candidate that satisfies
the trust gate can recover them at all**.

`HALT_TRUST_BOUNDARY_UNRESOLVED`.

---

## 3. What this ACT did NOT do, and why

| Not done | Reason |
|---|---|
| Turn the RED GREEN | The trust gate did not pass. G5 is conditional on `GO_BOUNDED_IMPLEMENTATION`. |
| Modify any production file | G3/G4 are conditional on `GO_BOUNDED_IMPLEMENTATION`. **Production delta: 0 bytes.** |
| Weaken, re-scope, skip or delete any RED assertion | G2.4: "Do not weaken the assertions to manufacture GREEN." The RED file is **byte-identical** to the predecessor's. |
| Replace the historical witness with a text fixture | The ACT names this exact failure mode. The RED fixture still places the adjudication in a `thinking` block with shape `[thinking, tool_use]`. |
| Change `basic_compaction_projection` | No production change at all. |
| Change `normal_provider_request` | No production change at all. |
| Re-enable the source-file excerpt carry-forward | `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED` remains `false`, asserted executably. |
| Change `MAX_CARRIED_OUTCOMES` | Remains `12`, asserted executably. |
| Introduce a memory subsystem / verdict ledger | Prohibited by the ACT and by G4. |
| Introduce a new public protocol field | Prohibited without separate authorization. |
| Build a VSIX / run a live model session | G9 is conditional on a safe GREEN. There is none. |
| Move the RED into the default suite | Gate 6: on a halt the RED stays isolated. |

---

## 4. Conservation summary

| Invariant | Result |
|---|---|
| Shipped production `src/` diff vs `ENTRY_HEAD` | **0 bytes** |
| RED witness modified by this ACT | **0 bytes** |
| Files touched by this ACT | **2**, both `*.test.ts` |
| `SOURCE_FILE_FACT_CARRY_FORWARD_ENABLED` | `false` (executable) |
| `MAX_CARRIED_OUTCOMES` | `12` (executable) |
| Canonical history | unchanged (executable) |
| Tool-use/result pairing | preserved (executable) |
| Sidecar schema / task contract / provider tool schemas | unchanged (diff) |
| No-op preparation | zero additional model calls (diff) |
| Session isolation | preserved (diff) |
| Typecheck diagnostics | **44** — the exact predecessor baseline; **ACT-owned: 0** |
| Context regression | **496 passed / 2 skipped**, 0 failures |

---

## 5. Next action and reopen condition

### 5.1 Next action

**Do not implement a repair.** The next step is a **decision about the
representation contract**, not another implementation attempt:

> Authorize (or decline) a **new model-output contract** that lets a model
> publish a qualified adjudication as a **structured, source-revision-bound,
> non-reasoning artifact** in the canonical record.

That authorization is **outside this bounded M1 repair** (G2.2's
`HALT_SCOPE_EXPANSION` condition) and requires a separate ACT.

### 5.2 Reopen condition — the RED is reopened when ANY of these becomes true

1. A structured adjudication carrier exists in the canonical record
   (a new content-block type, or a model-output protocol that produces one),
   **and** RED-3's thinking-placement assertion can be satisfied **without**
   reading arbitrary private reasoning.
2. The `agentic_summary` policy stops dropping `thinking` blocks **and** the
   RED-1/RED-2/RED-4 assertions still fail — i.e. the loss moved to a later
   boundary and the classification must be re-derived.
3. A future change makes the historical witness shape irrelevant (e.g. the
   model starts emitting verdicts in `text` blocks) — the RED fixture would
   then be measuring a shape that no longer occurs. *(Note: this is already
   partially true in practice — the S3 probe shows a text-placed adjudication
   is recoverable — but the HISTORICAL witness is still unrecoverable.)*
4. The compaction strategy changes from `agentic` to `basic` — the basic path
   uses the same `dropThinkingBlocks: true` policy, but the surrounding seam
   differs and the discriminators must be re-run.

### 5.3 What must NOT be used to reopen it

```
S1 / dropThinkingBlocks=false for agentic_summary   -> rejected (F5)
raw reasoning forwarding                            -> prohibited by the ACT
a regex denylist presented as a confidentiality proof -> prohibited (F5, §6)
lexical recognition of CONFIRMED/NARROWED/REFUTED   -> F3 proves this is
                                                       unsafe: Java column
                                                       names and the user's
                                                       rubric both match
```

---

## 6. The honest bottom line

The defect is **real**, **measured**, and **worth repairing**: three
source-grounded qualified adjudications were earned by the model and then
discarded at a compaction boundary, and the behavioural consequence (R7
re-listed as outstanding and re-verified) was observed in the canonical record.

The repair is **currently blocked** because the representation that would make
it safe does not exist yet. That is a **contract gap**, not a coding gap.

The ACT's success criterion was:

> "Success means preserving a legitimate adjudication through the demonstrated
> compaction boundary without expanding its authority or confidentiality
> exposure. **If that cannot be demonstrated with the current representation,
> stop cleanly and retain the RED.**"

This ACT stopped cleanly and retained the RED.
