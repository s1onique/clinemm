# 04 — Residual risk and operator handoff

## 4.1 What is NOT claimed

**No actual-source migration success is claimed.** This ACT:

- did NOT produce the FWMI v1 interchange package (that is codium-clinemm's
  historical-reconciliation ACT);
- did NOT run an import against the real `.factory/epic-board.md`, the real epic detail
  files or the real closure-plan store;
- did NOT verify the semantic quality of any real source range;
- did NOT perform the operator-executed source-bound qualification.

The `apply` command was exercised ONLY against an isolated scratch repository under
`/tmp`. The real repository was not written to.

The verdict is `PASS_STRUCTURAL_ONLY`. The next step is the operator's source-bound
qualification against the real package.

## 4.2 Residual risks

| Risk | Severity | Posture |
|---|---|---|
| The real FWMI package may contain field shapes the strict validator rejects. | HIGH | This is the intended posture: the validator is strict by contract, and a rejection names the exact code and subject. The operator sees the diagnostic before any write. |
| The real package may use a lifecycle or coverage value outside the FWMI v1 vocabulary. | HIGH | Rejected as `*_LIFECYCLE_INVALID` / `*_COVERAGE_INVALID`. Not coerced, not defaulted. |
| A real dependency may name a source identity the package does not carry. | MEDIUM | Rejected as `DEPENDENCY_UNRESOLVED` unless the reconciliation manifest accounts for it (then `DEPENDENCY_UNRESOLVED_ACCOUNTED`, a WARNING). |
| The producer may have mis-recovered a source range. | MEDIUM | The adapter cannot judge that. It verifies the RANGE and DIGEST SHAPE, not the prose meaning. The producer's `validation-receipt.json` is the authority on its own extraction quality, and a producer `FAIL` blocks the import. |
| The historical index may reference work items that no epic carries. | LOW | `HISTORICAL_WORK_ITEM_UNRESOLVED` (WARNING) — the historical record is preserved with the dangling reference visible. |
| `frontier.md` is prose and is not parsed for structure. | LOW | Deliberate. Parsing it would be building the universal semantic Markdown parser this ACT forbids. It is checked for presence of content only. |

## 4.3 What the operator must do

1. Wait for codium-clinemm to produce `.factory/migration/FWL02/` with the six FWMI v1
   artifacts.
2. Transfer the package to a sandbox that can reach this repository.
3. Run the five commands, in order:

```bash
# 1. dry-run interchange validation
bun tools/factory/fwmi/cli.ts validate --package=<FWMI_PACKAGE_DIR>

# 2. shadow import
bun tools/factory/fwmi/cli.ts shadow --package=<FWMI_PACKAGE_DIR>

# 3. apply, then persisted conservation verification
bun tools/factory/fwmi/cli.ts apply   --package=<FWMI_PACKAGE_DIR>
bun tools/factory/fwmi/cli.ts verify  --package=<FWMI_PACKAGE_DIR>

# 4. historical lookup
bun tools/factory/fwmi/cli.ts lookup <ACT_ID>

# 5. exact replay
bun tools/factory/fwmi/cli.ts replay --package=<FWMI_PACKAGE_DIR>
```

or, equivalently, `bun run fwmi:validate`, `fwmi:shadow`, `fwmi:verify`, `fwmi:lookup`,
`fwmi:replay`, `fwmi:apply`.

4. Read the command 5 output. `RESULT: EXACT REPLAY CLEAN` with `byteDelta=0` is the
   gate for cutover; a non-zero byte delta means the persisted canonical bytes differ
   from the plan and the import is not reproducible.
5. Read the command 3 output. Any `ERROR` finding is a conservation failure that blocks
   cutover. `WARNING` findings are the coverage statements the operator must read, not
   noise to be suppressed.

## 4.4 Boundary notes for the next ACT

- The imported records live in `docs/closure-plans/imported/`. They are NOT native
  closure plans and must never be counted as repository-native closure plans by the
  board validator's conservation gate or by any other consumer.
- The imported historical index is the MIGRATED side of the historical lookup surface.
  The repository-native side remains the board's historical census plus the per-epic ACT
  ledgers. The lookup spans both and never upgrades a verdict.
- The `IECR_CONSOLIDATED_BOARD_NOT_PRESENT_IN_SOURCE` result, if the producer reports it,
  is NOT a failure of historical reconciliation and NOT an import blocker. IECR is a
  NEW-EPIC INTAKE, handled by a separate path (FWL02-D), not by this historical import.
- This adapter does not and must not become the mechanism for new-epic registration.
  Registering a new epic introduces engineering decisions made outside the repository;
  that is a different operation with a different authority source.
