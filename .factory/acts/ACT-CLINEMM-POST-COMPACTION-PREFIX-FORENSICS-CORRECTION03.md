# ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION03

**Type:** bounded correction of the **evidence-authority** defects of
`ACT-CLINEMM-POST-COMPACTION-PREFIX-FORENSICS-CORRECTION02`.
**Scope:** exactly the P0 and the P1s named by the CORRECTION02 review. No new
architectural investigation, no stale-read-policy change, no new inference run,
no push, no VSIX replacement, no Strata restart.

---

## 0. The verdict this correction adopts

`HALT_INCOMPLETE_LINEAGE_ACCEPTED` for live forensic qualification.

The review's central claim is **CONFIRMED by execution** and is corrected here.

CORRECTION02 is **RETAINED**: the inverted lineage model, the within-request /
consecutive-turn / retry distinction and the three-stage bundle aggregation are
correct and are not touched by this correction.

---

## 1. The defects this correction closes

### 1.1 P0 — a MISSING identity could still produce `consecutive_turn`

`establishRequestLineage()` checked that the preparation and attempt identities
DIFFER only when BOTH were present:

```ts
if (
    before.preparationRequestId !== undefined &&
    after.preparationRequestId !== undefined &&
    before.preparationRequestId === after.preparationRequestId
) {
    return { consecutive: false };
}
```

A record with **no** preparation identity therefore **SKIPPED** the check
entirely and fell through to `return { consecutive: true, relation: "consecutive_turn" }`.

That promoted **incomplete** capture evidence into a **positive** attribution and
contradicted CORRECTION02's own stated contract that *"every required identity is
mandatory"*.

**Correction.** The gate now requires a **non-empty** cohort, session, iteration,
preparation identity and attempt identity **on both sides**. A missing identity is
`NOT_AUTHORITATIVE` with an explicit reason naming the identity. A timestamp is
**never** substituted.

### 1.2 P0 — the public bundle comparator could claim authority on its own

`comparePrefixForensicsBundles()` returned `authoritative: true` after a cohort
compatibility check, **without** independently validating the consecutive-turn
lineage. The CLI applied a separate check, so any other caller could bypass it.

**Correction.** The comparator now **applies the lineage gate itself** and
returns `authoritative: false` with a reason when the two bundles are not proven
consecutive turns.

### 1.3 P1 — conflicting same-stage records were silently overwritten

`groupCapturesIntoRequestBundles()` used `stages.set(...)`, so a second record for
the same identity **and** the same stage **replaced** the first. Which observation
is authoritative is not decidable from the capture; it was decided by file order.

**Correction.** A **byte-identical re-emission** is a harmless duplicate and is
collapsed. A **conflicting** duplicate is **EXCLUDED**: the stage is removed from
the bundle and reported `UNAVAILABLE_FROM_TRACE`, so the comparison fails closed
instead of asserting a boundary it cannot establish.

### 1.4 P1 — the CLI omitted tool-only, system-only and body-only changes

The CLI selected its first differing stage with

```ts
diff.stages.find((candidate) => candidate.available && candidate.differences.length > 0)
```

which reads **only** the MESSAGE list. A tool-only, system-only or body-only
change was correctly detected by the analyzer and then **omitted** from the
CLI's reported first difference — a regression of CORRECTION01's own fix.

**Correction.** The stage is selected by `diff.earliestDifferingStage` and the
report carries **every** detected change category (`messages`, `tools`, `system`,
`body`) in a new `differingCategories` field.

### 1.5 P1 — the negative controls could pass VACUOUSLY

CLI-03, CLI-04 and CLI-05 iterated over `result.pairs` and asserted inside the
loop. A CLI that produced **zero** pairs satisfied every assertion.

**Correction.** Each negative control now asserts the **exact expected pair
count** (`toHaveLength(1)`), so the control cannot pass by producing nothing.

### 1.6 P1 (found by execution, not by the review) — the CLI was not runnable as a real Node process

The CLI is a **development tool** invoked from source as
`node --experimental-strip-types prefix-forensics-analyzer-cli.ts <dir>`. Its
relative imports were **extensionless**:

```ts
import { ... } from "./prefix-forensics-analyzer";
```

The package is `"type": "module"` — pure ESM — where an extensionless relative
specifier is **invalid per the ESM specification**. Node 26 (the runtime present
in this environment) rejects it outright:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../prefix-forensics-analyzer'
  imported from .../prefix-forensics-analyzer-cli.ts
```

This was **reproduced at pristine HEAD `a49bd8e5d`**, so it is a pre-existing
defect that the CORRECTION02 CLI suite could not surface on this runtime.

**Correction.** The CLI and the analyzer now use **explicit `.ts` extensions** in
their relative imports, and `allowImportingTsExtensions` is enabled in the
tsconfigs that consume the shared source. The CLI is now **genuinely runnable as
a real Node process** on the current runtime — which is what makes CLI-07 and
CLI-08 real end-to-end witnesses rather than in-process assertions.

---

## 2. The reopen condition

> *One real-CLI RED->GREEN test group. Rerun the focused suites and stop.*

`sdk/packages/shared/src/runtime/prefix-forensics-analyzer-cli.test.ts` drives the
CLI as a **real process** over a **real directory** of capture records.
`sdk/packages/shared/src/runtime/prefix-forensics-analyzer.test.ts` adds the
seven authority witnesses `AUTH-01` … `AUTH-07`.

| Witness | Control | Result |
|---|---|---|
| AUTH-01 | a MISSING preparation identity | **REFUSED** |
| AUTH-02 | a MISSING attempt identity | **REFUSED** |
| AUTH-03 | a MISSING cohort | **REFUSED** |
| AUTH-04 | the bundle comparator applies the lineage gate ITSELF | **PASS** |
| AUTH-05 | the comparator REFUSES two bundles that are not consecutive turns | **REFUSED** |
| AUTH-06 | a CONFLICTING same-stage duplicate is EXCLUDED, not overwritten | **EXCLUDED** |
| AUTH-07 | an IDENTICAL same-stage duplicate is collapsed, not excluded | **COLLAPSED** |
| CLI-01 | two complete three-stage requests -> authoritative B->C | **PASS** |
| CLI-02 | a third append-only continuation -> authoritative C->D | **PASS** |
| CLI-03 | a RETRY (same preparation, different attempt) | **REFUSED**, exactly 1 pair |
| CLI-04 | a NON-ADJACENT iteration gap (29 -> 31) | **REFUSED**, exactly 1 pair |
| CLI-05 | a CROSS-SESSION pair | **REFUSED**, exactly 1 pair |
| CLI-06 | a bundle with a MISSING stage | reported incomplete, never as equal |
| CLI-07 | the report names EVERY change category | **PASS** (body-only change attributed) |
| CLI-08 | a CONFLICTING same-stage duplicate | **EXCLUDED**, stage reported unavailable |

### 2.1 RED — the witnesses fail against the CORRECTION02 implementation

Reverting **only the two production files** to their `a49bd8e5d` content while
keeping the new witnesses:

```
× AUTH-01: a MISSING preparation identity can never be a consecutive turn
× AUTH-02: a MISSING attempt identity can never be a consecutive turn
× AUTH-03: a MISSING cohort can never be a consecutive turn
× AUTH-05: the bundle comparator REFUSES two bundles that are not consecutive turns
× AUTH-06: a CONFLICTING same-stage duplicate is EXCLUDED, not silently overwritten
× CLI-01 … × CLI-08

Tests  13 failed | 22 passed (35)
```

### 2.2 GREEN

```
Tests  35 passed (35)
```

---

## 3. Conservation

| Gate | Result |
|---|---|
| Analyzer + CLI suite (35 tests) | **PASS** — and **13 FAIL** against the CORRECTION02 implementation |
| shared package sweep | **608 passed / 6 skipped**, 0 failed (was 599: **+9**) |
| llms package sweep | 17 failed / 1170 passed — **identical at pristine HEAD** (was 1168: **+2**) |
| agents package sweep | 43 failed / 560 passed — **identical at pristine HEAD** |
| apps/vscode vitest sweep | 63 failed files / 475 passed — **one FEWER failure** than pristine HEAD (64 failed / 474 passed); no new failure |
| Typecheck (shared, llms, agents, apps/vscode) | **EXIT 0** |
| Build (shared) | **EXIT 0** — bundle **and** declaration emit |
| Biome lint | **EXIT 0** (2 infos; the same pre-existing `noNonNullAssertion` convention as the CORRECTION02 suite) |
| Provider semantic delta | **NONE** — no provider request, no retry/compaction behaviour change, no prompt change |
| New inference run | **NONE** |

The llms, agents and apps/vscode failures are **pre-existing** and were each
measured at pristine HEAD `a49bd8e5d` in the same session:

- llms — `src/providers/ai-sdk-reasoning.test.ts` (15) and
  `src/providers/vendors/openai-compatible.wire.test.ts` (2): reasoning-effort
  mapping, unrelated to prefix forensics.
- agents — 9 files covering abort-cause retention, edit-efficiency trace, hub
  trace cardinality and MiniMax reasoning traces: unrelated to prefix forensics.
- apps/vscode — 63/64 failing files are the `src/sdk/__tests__/` bootstrap,
  myc-prime and completion-continuation suites: unrelated to prefix forensics.

The apps/vscode sweep moved from **64 failed files** to **63 failed files**
because the explicit-`.ts`-extension fix unblocked one previously-unloadable
suite. There is **no new failure**.

---

## 4. What is NOT changed

- The CORRECTION02 lineage model, the three-stage bundle aggregation and the
  wire preparation identity are **RETAINED** as delivered.
- The wire-capture and completeness repairs of CORRECTION01 are **RETAINED**.
- The causal separation is **RETAINED**: `PREFIX_MUTATION_ISOLATED` stays closed;
  `STRATA_PLATEAU_CAUSE_UNPROVEN` stays **OPEN**.
- The stale-read policy is **not** touched.
- No push, no VSIX replacement, no inference-service restart, no provider request.

---

## 5. What the next step now is

The instrumentation is fit for live forensic qualification. The review's
disposition is adopted: once the live capture is authorized, the successor
experiment is the one already recorded — correlate ONE rewrite with the next two
or three Strata cache decisions, distinguishing the cost of the initial prefix
invalidation, how quickly the new prefix becomes cacheable, and whether
checkpoint retention prevents recovery.

Strata's own documentation distinguishes checkpoint PLACEMENT from exact-prefix
MATCHING: `--prompt-cache-spread` changes which checkpoints SURVIVE rather than
restoring compatibility between different token sequences. That is why the
three-request comparison — rewrite, next request, next continuation — is decisive,
and why the corrected CLI must be able to produce exactly that comparison.

**Live qualification is authorized only after this bounded patch passes its
gates.** It has now passed them: the authority invariants hold, the negative
controls are non-vacuous, and the CLI is genuinely runnable end to end.
