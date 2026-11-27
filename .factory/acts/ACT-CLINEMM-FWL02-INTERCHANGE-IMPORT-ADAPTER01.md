# ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01

**Primary epistemic purpose:** `DETERMINISTIC_IMPLEMENTATION` (bounded adapter from the
FWMI v1 migration interchange into the existing ClineMM ledger records and historical
archive index)

**Authorization:** `C1: GO.` (operator brief "FWL02 — Interchange Import Contract")

**Verdict:** `PASS_STRUCTURAL_ONLY` (deterministic implementation + focused executable
            qualification GREEN; actual-source migration NOT executed — the operator
            supplies the real interchange package after codium-clinemm completes its
            reconciliation)

---

## 0. Hard scope

This ACT implements the **smallest deterministic adapter** that consumes a FWMI v1
migration interchange package and produces existing ClineMM canonical ledger records
plus a historical archive index.

In scope:

- The FWMI v1 contract (the operator-supplied interchange format).
- Strict validation of interchange records.
- Deterministic translation into `docs/closure-plans/imported/*.json` ledger records
  (the EXISTING closure-plan store, in an additive namespace).
- An imported historical archive index (`docs/closure-plans/imported/historical-index.json`).
- Persisted semantic conservation verification.
- Historical ACT lookup across the native and imported archives.
- Exact-replay byte-delta proof.
- Legacy Markdown migration retained as read-only RECONNAISSANCE tooling.

Explicitly OUT of scope:

- Implementing a universal semantic Markdown parser.
- Implementing another canonical data model (the adapter reuses the existing
  closure-plan record shape).
- Any new database, LLM integration, daemon, orchestration layer or GUI.
- Building the FWMI package itself (that is codium-clinemm's historical-reconciliation ACT).
- Modifying `.factory/epic-board.md`, `.factory/epics/*.md`, or any existing closure plan.
- Any Leamas-side work.

---

## 1. The two invariants that dominate every design decision

**I1 — An imported historical qualification assertion is NOT newly verified evidence.**
The FWMI `qualification` vocabulary (`UNKNOWN`, `UNQUALIFIED`, `PARTIAL`,
`STRUCTURAL_ONLY`, `LIVE_QUALIFIED`, `ACCEPTED`, `INSUFFICIENT`, `REJECTED`) records
what the SOURCE reported. The adapter carries it verbatim into
`acceptance.source_qualification` and writes `acceptance.state =
"NOT_VERIFIED_BY_IMPORT"`. `NOT_VERIFIED_BY_IMPORT` is the only state the importer can
write — the TypeScript type makes an accepted state unrepresentable.

**I2 — `SOURCE_RECONCILIATION_READY` is NOT authoritative cutover approval.** It is a
reconciliation-state marker. The adapter carries it into
`acceptance.interchange_reconciliation_state` so a reader can see it, and never turns it
into an acceptance. A producer verdict of `HALT_REPOSITORY_TRUST` is an import-blocking
ERROR.

---

## 2. Why the legacy Markdown adapter was not extended

The operator's FWL02-A baseline (preserved at `/tmp/fwl02.3kjYK9Nh/`) measured the legacy
Markdown adapter against the real board:

```text
root board                       44,730 lines / 3,571,144 bytes
epic Markdown files              22
extracted sections               211
extracted work-item reps         61
persisted work items             59
extracted historical ACT ids     133
persisted ACT records            0
persisted acceptance criteria    0
persisted dependency relations   0
persisted evidence references    0
unknown/missing status shown as deferred   36 items
```

Storage, schema validation and byte-identical replay succeeded. **Semantic conservation
did not.** The legacy path structurally cannot carry acceptance criteria, typed
dependencies, evidence references or blockers, and it conflates an absent source status
with an intentional deferral.

Rather than extend a regular-expression Markdown parser to recover engineering meaning
(which this ACT forbids), the semantic interpretation is separated from the deterministic
application: a separate agent produces a source-bound FWMI v1 interchange, and this
adapter applies it deterministically. The legacy path is retained as read-only
reconnaissance tooling (`tools/factory/fwmi/recon.ts`).

---

## 3. Architecture

```text
tools/factory/fwmi/
  contract.ts   the operator-supplied FWMI v1 contract (data only)
  digest.ts     SHA-256 and exact source-range byte extraction
  load.ts       shallow package load (existence, JSON, schema_version)
  validate.ts   STRICT semantic validation (ERROR / WARNING / INFO)
  plan.ts       THE ADAPTER: package -> ledger records + archive index
  apply.ts      transactional write; byte-delta computation; atomic replace
  conserve.ts   PERSISTED SEMANTIC CONSERVATION verification (C1..C9)
  lookup.ts     historical ACT lookup (native + imported archives)
  recon.ts      legacy Markdown reconnaissance (read-only)
  cli.ts        the five operator commands
  fwmi-adapter.test.ts   focused executable qualification (28 tests)
```

The adapter is a PURE function of the package. It performs no I/O beyond hashing the
serialized records, so the same package always yields byte-identical entries — which is
what makes the exact-replay byte check meaningful.

### 3.1 Where the records land

Imported records live in `docs/closure-plans/imported/<EPIC>__<ITEM>.json`. This is the
EXISTING closure-plan store, in an ADDITIVE namespace, so an imported record can never
collide with a repository-native closure plan and its provenance is visible in the
directory listing. The importer writes no other path: the board, the epic detail files,
the native closure plans and every evidence package are untouched.

---

## 4. The persisted conservation checks

`conserve.ts` re-reads what was actually written and compares it to the interchange,
field by field. It is deliberately NOT a byte comparison: byte equality proves
determinism, not meaning.

| Check | Requirement discharged |
|---|---|
| C1 | Source identity preserved (`source_epic_id`, `source_item_id`, `scoped_id`) |
| C2 | Provenance preserved (every `source_ref`, byte for byte) |
| C3 | Unknown status distinct from intentional deferral |
| C4 | Unresolved lifecycle and unresolved reconciliation preserved |
| C5 | Explicit dependencies, criteria, blockers and their coverage preserved |
| C6 | Historical ACT lookup preserved with the original verdict |
| C7 | No acceptance promotion (`NOT_VERIFIED_BY_IMPORT`, unchanged qualification) |
| C8 | Cross-links conserved without duplicating authoritative obligations |
| C9 | Reconciliation readiness is not recorded as an acceptance |

---

## 5. Exact CLI commands

```bash
# 0. reconnaissance (read-only; the legacy Markdown path, retained)
bun tools/factory/fwmi/recon.ts

# 1. dry-run interchange validation
bun tools/factory/fwmi/cli.ts validate --package=<FWMI_PACKAGE_DIR>

# 2. shadow import (computes the plan and the canonical byte delta; writes nothing)
bun tools/factory/fwmi/cli.ts shadow --package=<FWMI_PACKAGE_DIR>

# 3. persisted conservation verification (re-reads what was written)
bun tools/factory/fwmi/cli.ts verify --package=<FWMI_PACKAGE_DIR>

# 4. historical lookup
bun tools/factory/fwmi/cli.ts lookup <ACT_ID>

# 5. exact replay (zero unintended canonical byte delta)
bun tools/factory/fwmi/cli.ts replay --package=<FWMI_PACKAGE_DIR>

# apply (the only command that writes)
bun tools/factory/fwmi/cli.ts apply --package=<FWMI_PACKAGE_DIR>
```

Every command accepts `--repo=<root>` (defaults to the enclosing repository) and
`--json` (machine-readable output). Exit codes: `0` success, `1` a check failed, `2`
usage or input error.

Package.json aliases: `bun run fwmi:validate`, `fwmi:shadow`, `fwmi:verify`, `fwmi:lookup`,
`fwmi:replay`, `fwmi:apply`, `fwmi:test`, `fwmi:check-types`.

---

## 6. Authorized state transitions

The adapter writes exactly ONE state transition, and only from a validated package:
`unpersisted -> persisted ledger record`. It never writes a scheduling-state transition,
because the FWMI lifecycle vocabulary and the local closed-class vocabulary are
different axes, and the brief forbids treating an interchange state as a local
authoritative transition without an explicit mapping.

A source status outside the FWMI vocabulary is an import-blocking ERROR
(`ITEM_LIFECYCLE_INVALID`), not a guess.

---

## 7. What was NOT done

- The FWMI package was NOT produced. codium-clinemm's historical-reconciliation ACT owns
  that; the operator supplies the real package afterwards.
- NO actual-source migration was executed against the real board. The `apply` command was
  exercised only against an isolated scratch repository.
- NO production ClineMM code was changed. The adapter is factory tooling.
- NO board, epic file, native closure plan or evidence package was modified.
- No Leamas-side work was performed.
- The M1–M5 ledger-integrity corrections are Leamas-side (FWL01 "accepted with remaining
  integrity corrections") and are outside this repository. The ClineMM-side obligation
  they imply — that the import path must not weaken native ledger integrity — is
  discharged by the strict validator and the C1–C9 conservation checks.

---

## 8. Evidence

`.factory/evidence/ACT-CLINEMM-FWL02-INTERCHANGE-IMPORT-ADAPTER01/`
