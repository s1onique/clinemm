# 01 — Executable gates

```text
TESTS       bun test tools/factory/fwmi/fwmi-adapter.test.ts
✓ FWMI v1 legacy Markdown reconnaissance > does not treat an absent status as an intentional deferral [1.00ms]

 28 pass
 0 fail
 114 expect() calls
Ran 28 tests across 1 file. [228.00ms]

TYPECHECK   bun x tsc --noEmit -p tools/factory/fwmi/tsconfig.json
  (no diagnostics; exit 0)

BIOME       bun x --bun @biomejs/biome check tools/factory/fwmi/ --diagnostic-level=error
Checked 17 files in 18ms. No fixes applied.
```

## The 28 tests, by requirement

| Requirement | Test |
|---|---|
| Strict validation: valid package accepted | `accepts a well-formed package` |
| Strict validation: missing artifact rejected | `rejects a package with a missing artifact` |
| Strict validation: wrong schema version rejected | `rejects a package whose schema version is wrong` |
| Strict validation: malformed source digest rejected | `rejects a source reference whose digest is malformed` |
| Strict validation: inverted source range rejected | `rejects a source reference with an inverted line range` |
| Unsupported/ambiguous authoritative transition rejected | `rejects an unsupported authoritative state transition` |
| Unresolvable dependency rejected | `rejects a dependency that resolves to nothing and is not accounted for` |
| Producer FAIL blocks the import | `rejects a package whose producer receipt reports a failing check` |
| Producer HALT blocks the import | `rejects a package whose producer halted on repository trust` |
| Duplicate epic identity rejected | `rejects duplicate epic identities` |
| Unknown status distinct from deferral | `preserves unknown status distinctly from intentional deferral` |
| Original verdict preserved, no promotion | `preserves the original verdict without acceptance promotion` |
| SOURCE_RECONCILIATION_READY is not approval | `does not treat SOURCE_RECONCILIATION_READY as cutover approval` |
| Cross-links conserved, no duplicated obligation | `conserves cross-links without duplicating authoritative obligations` |
| Dependencies + criteria + coverage preserved | `preserves explicit dependencies and criteria with their coverage` |
| Unresolved migration records preserved | `preserves unresolved migration records` |
| Additive namespace only; existing surfaces untouched | `writes the imported ledger records into the imported namespace only` |
| Exact replay = zero unintended byte delta | `produces zero unintended canonical byte delta on an exact replay` |
| Determinism | `is deterministic: the same package yields byte-identical records` |
| Persisted semantic conservation | `passes persisted semantic conservation after an import` |
| C3 detects unknown-status-to-deferred normalisation | `detects a persisted record whose unknown status was normalised to deferred` |
| C7 detects acceptance promotion | `detects a persisted record whose verdict was promoted to acceptance` |
| C5 detects a lost explicit dependency | `detects a lost explicit dependency` |
| Historical ACT lookup with original verdict | `preserves historical ACT lookup with the original verdict` |
| Unresolved historical record stays unresolved | `preserves an unresolved historical record as unresolved` |
| Missing historical ACT reported not-found | `reports a missing historical ACT as not found` |
| Legacy reconnaissance is structural only | `measures the legacy surface without claiming semantic meaning` |
| Absent status counted, not silently deferred | `does not treat an absent status as an intentional deferral` |
