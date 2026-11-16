# ACT-CLINEMM-COMPACTION-DECISION-CAPTURE01 — CORRECTION01

**Verdict: `PASS_WITH_NONBLOCKING_RESIDUE` — C1: GO for commit and operator packaging.**

This correction closes the two P0 findings from the final CAPTURE01 review without
changing the production compaction policy, estimator, threshold, summarizer, or
provider request behavior.

## P0 corrections

1. **Exported mode and strategy identity.** The producer now publishes
   `compactionMode` and `compactionStrategy`, matching the finite
   `LATENCY_METADATA_ALLOWLIST`. Auto, manual, and overflow-recovery decisions
   therefore survive final trace sanitization.
2. **Diagnostics-OFF performs no capture work.** A decision payload is built
   only when an actual sink exists and is not explicitly disabled. The absent or
   disabled path publishes no decision identity, does not advance the ordinal,
   and adds no provider-message JSON serialization beyond the pre-existing
   production work.

The formerly misleading `Exactly at threshold` test was renamed to `Trigger
arithmetic: shouldCompact follows the production >= policy`; it proves the
production comparison and a strictly-below-threshold fixture, not a fabricated
equality witness.

## Executed gates

- Focused decision-capture suite: **23/23 passed**.
- Full core context scope: **344 passed, 2 skipped**.
- Latency/runtime observability and orchestration scope: **423/423 passed**.
- Biome: **clean on all 6 ACT-owned source/test files**.
- SDK core typecheck: **43 known baseline diagnostics; zero in ACT-owned files**.
- `git diff --check`: **clean**.

## Artifact and qualification boundary

The historical bundle SHA, source HEAD, and package state in the original six
evidence artifacts describe the **pre-correction working-tree build**. They are
retained as historical receipts and MUST NOT be presented as the corrected
artifact identity.

No VSIX was produced by this correction. The operator must build and package
from the new committed HEAD, record the source HEAD, VSIX SHA-256/size, and
embedded bundle hash, install into the isolated `~/.vscodium-roz` profile, and
qualify at least one real automatic-compaction decision. Full Round C remains
NO-GO until that live capture passes.

The protected stash and unrelated files are preserved.
