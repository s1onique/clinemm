# 05 — RED → GREEN and the necessity ablation

**ACT:** `ACT-CLINEMM-ADJUDICATION-CONTINUITY-REPAIR-01`
**Status:** **The RED was NOT turned GREEN.** The trust gate halted before
any production change was authorized.

---

## 1. The RED's load-bearing assertions — status

| Test | Invariant | Status at exit |
|---|---|---|
| **RED-1** | Qualified adjudication reaches provider-visible continuation | **STILL RED** — correctly so; see §3 |
| **RED-2** | Adjudication survives when older tool outcomes fall outside the 12-outcome window | **STILL RED** — correctly so |
| **RED-3** | Original thinking-only case is addressed without exposing arbitrary thinking | **STILL RED** — correctly so; §3 explains why this is unachievable within the bounded candidate set |
| **RED-4** | Task-contract objective and later adjudication remain distinct | **STILL RED** — correctly so |
| **RED-5** | Historical canonical block shape is handled at the demonstrated boundary | **STILL RED** — correctly so |

**No assertion was weakened, deleted, skipped, or re-scoped.** The RED file
`compaction.adjudication-continuity.red01.test.ts` was **not modified by this
ACT** (`git diff d69cfb9be..HEAD -- <red file>` → empty).

The historical witness was **not** replaced with an ordinary assistant-text
fixture. The RED's fixture still places the adjudication in a `thinking` block
with block shape `[thinking, tool_use]`, exactly as measured.

---

## 2. The A/B/C ablation — status

The G0.2-corrected ablation remains executable and still demonstrates the
necessity of preserving the adjudication state:

| Arm | Input | Observed |
|---|---|---|
| **A** | original production projection (`agentic_summary`) | **RED** — no verdict token, no qualification token |
| **B** | identical projection + the bounded adjudication restored into the ONE identified message | **present** — verdict token AND qualification token |
| **C** | B with the restoration removed | **RED returns** |

The A/B/C inputs are identical, and the restoration changes nothing but the
adjudication (the residual structured message lists are exactly equal).

**What the ablation does and does not establish:**

- It establishes that carrying that specific state is **structurally
  necessary** for it to survive the M1 boundary.
- It does **not** establish that any deployed mechanism carries it — the
  ablation is **test-local** and was never promoted to production. This is
  exactly the distinction the ACT draws between "a mechanism that only makes
  a test-local predicate return true is not sufficient" and the structural
  necessity claim.

**Label:** `REAL_PRODUCTION_SEAM` (test-local ablation) / `STRUCTURAL`
(necessity).

---

## 3. Why the RED cannot be turned GREEN inside the bounded candidate set

This is the substantive result, and it is a direct consequence of the
measurements in `02-trust-feasibility-probe.md`.

RED-3 asserts two things simultaneously:

```ts
// The CONTROL: the ordinary-text position DOES reach the summarizer.
expect(text.request).toContain(ADJUDICATION);

// The RED: neither thinking-block position reaches the summarizer.
expect(inside.request).toContain(ADJUDICATION);
expect(beyond.request).toContain(ADJUDICATION);
```

For RED-3 to become GREEN, the **thinking-placed** adjudication must reach
the summarizer **without** exposing arbitrary thinking. Given the measured
facts:

1. The adjudication exists in the thinking block and nowhere else
   (measured: each phrase occurs exactly once in the 196-message record).
2. The thinking block contains no structured verdict field (measured: 0
   across all 97 thinking blocks).
3. Therefore reaching it requires reading free-form private reasoning prose.
4. Reading free-form private reasoning prose **is** exposing arbitrary
   thinking, because the verdict shares its block with unrelated
   side-questions and speculative severity numbers (measured: the S1 probe
   shows both leak through).

So RED-3 is **unsatisfiable** under every mechanism the trust gate permits.
It is satisfiable only by S1 (raw thinking), which the ACT rejects on
trust/disclosure grounds and G4 prohibits.

**A GREEN obtained by weakening RED-3 — for example by relaxing the
`thinking` fixture to a `text` fixture — would be exactly the
"replace an original historical witness with an ordinary assistant text
fixture and call the historical RED repaired" failure the ACT names.**

---

## 4. What would make the RED GREEN (for a successor ACT)

Only a mechanism that satisfies the full G3 contract **and** reaches the
historical shape can do it. Since the historical shape has no structured
carrier, that mechanism must introduce one — a new model-output contract or a
new structured adjudication channel. Both are outside this bounded M1 repair
(see `03-mechanism-selection.md` §5).

Such a successor would be **future-facing only**, and this ACT explicitly
does **not** claim it repairs the historical R3/R7/R8 loss.
