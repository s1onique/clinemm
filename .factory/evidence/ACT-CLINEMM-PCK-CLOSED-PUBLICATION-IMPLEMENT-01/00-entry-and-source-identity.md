# 00 — Entry and source identity

```text
ACT: ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01

ENTRY_HEAD:  0f111f3d76a7e7da9b792cfd173d88635156182c
BRANCH:      main
WORKTREE:    /Volumes/UserData/Users/chistyakov/Projects/SPbNIX/clinemm
TRACKED_DIRT: NONE at entry (git diff --stat HEAD was empty)
UNTRACKED_PATHS:
  .factory/evidence/ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01/
  .factory/evidence/ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01/
  sdk/packages/core/scripts/source-visibility-discriminator.generate.ts
  sdk/packages/core/src/extensions/context/output-trust-boundary/
  sdk/packages/core/src/extensions/context/source-visibility-discriminator/
PROTECTED_STASHES: none existed at entry; none popped; none mutated
INSTALLED_EXTENSION_VERSION: 4.1.26 (s1onique.clinemm, two builds present:
  s1onique.clinemm-4.1.26-502d31c58 and s1onique.clinemm-4.1.26-613295a95)
BUN_VERSION: 1.4.4 (the repo pins 1.4.2 in .tool-versions)
VITEST_VERSION: 4.1.10
NODE: not on PATH in the ACT shell; Bun 1.4.4 is the runtime used
```

## The expected historical anchor

```text
The ACT named 0f111f3d76a7e7da9b792cfd173d88635156182c as the expected
historical anchor. The ENTRY_HEAD DISCOVERED AT RUNTIME is exactly that
value, so the expected and the discovered identities AGREE.
```

## G0.2 — Predecessor artifacts

The last digest reported **63 untracked files** belonging to the
source-visibility and output-trust-boundary investigations. At entry they
were **STILL UNTRACKED**:

```text
sdk/packages/core/src/extensions/context/source-visibility-discriminator/  13 files
sdk/packages/core/src/extensions/context/output-trust-boundary/           11 files
sdk/packages/core/scripts/source-visibility-discriminator.generate.ts     1 file
.factory/evidence/ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01/   27 files
.factory/evidence/ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01/             23 files
```

Every SHA-256 in the predecessor's recorded manifest was **RE-VERIFIED** at
entry and **MATCHED EXACTLY**. The re-verification is recorded in
`verification/predecessor-source-hashes.txt`.

The predecessor's 13 source-file digests, re-verified:

```text
ef0476b3d13f12137a269fa2c310c32fd9ea939d951817fcaa306c41b9247cd2  projection.ts
f25d78dfd0817672708035cd8bb884b346fbddba06dc6f6a5badee8176f43975  trust.ts
c643cd977e7ce5484766c06dfa82e391a79d7f55a0016d23fdf3ef0471cd822e  candidate-views.ts
6d30b2ff0e52f6a7b59b525a24f91d1641e2e63770fd8a6277c8877fd4134a3e  content-origin.ts
31a23a75929ff6e860733e14410b4687d0d307b69d5f93f638f80b43a5f91e0f  selection.ts
6be1c73f220d3815211bcf1d2edbbf9d9dcce496a433048d6ea6d7acb5074d41  discriminator.fixture.ts
ebe50ada6cd8898b7cb385b2d3435a3f994a07b10802d41267ff426255d9a97a  security-controls.test.ts
8a1f9ed38631d1f0de0e2a071942e80361647449f3adefe441c289b2b258fafa  trust-provenance.test.ts
064c645abdfbc818030d9472acbd04c2071cf2980ab12ccb0e60a0d55613cffe  causal-ablation.test.ts
2456a702806228a3f51b636fe58c95ea3c6e653b7aabb1c17068361697c46ae3  visibility-red.test.ts
34f650aa571ccbc5e1d0ee19e483a7f53ee7c30907ec3c3354e6b55c64ff6963  selection.test.ts
ba774ee88cd60a34c38771fb65e4ef730588df18756869b69efa262a3ab17fcf  reasoning-boundary.test.ts
14f9c87f867afd8091c3673d91f90ca4457330c8c9ce80b949cfd056abe256a8  model-evaluation.test.ts
```

The predecessor's own suite was executed at entry as a custody check:
**110 passed / 13 files**.

## WHAT WAS PRESERVED AND WHAT WAS NOT IMPORTED

```text
PRESERVED
  - the predecessor's RED conclusions, byte-for-byte, in the untracked
    trees; they were read, never modified, never staged;
  - the predecessor's security counterexamples, re-implemented AGAINST the
    PRODUCTION gate in this ACT's own test files rather than edited into
    the predecessor's files;
  - the predecessor's historical exit report, verbatim, in the
    untracked evidence tree.

NOT IMPORTED
  - the predecessor's experimental framework was NOT copied into
    production. Only the DEMONSTRATED Candidate A mechanism was ported:
    the closed vocabulary, the host-minted identifier, the reference
    MEMBERSHIP check, the runtime-rendered statements and qualifications,
    the model-authored banner, and the deterministic projection.
  - the predecessor's `source-visibility-discriminator/` and
    `output-trust-boundary/` modules remain TEST-LOCAL and untracked. The
    production implementation is SELF-CONTAINED in tracked source.

TERMINAL CLEANUP
  - NONE was performed. The predecessor's untracked evidence was NOT
    removed, so no cleanup is mixed with this ACT's source changes.
```

## G0.3 — Trust inventory (as found at the entry HEAD)

```text
Compaction modes:            auto, manual, overflow_recovery
Compaction strategies:       agentic, basic, custom (userCompaction.compact)
Context-trigger path:        createContextCompactionPrepareTurn, shouldCompact
                             = requestInputTokens >= requestTriggerTokens
Overflow-recovery path:      context.overflowRecovery -> effectiveMode
                             "overflow_recovery" -> custom compactor, then
                             DETERMINISTIC basic compaction (never depends on
                             another successful LLM request)
Provider configuration:      resolveConnectionProviderConfig(config) per turn;
                             resolveSummarizerConfig for the summarizer
Model identity:              actModeApiModelId = MiniMax-M3, reached through
                             the openai-compatible transport at
                             https://api.minimax.io/v1
Task-contract projection:    applyTaskContractToCompactedMessages
Verified-outcome projection: applyVerifiedEvidenceToCompactedMessages
                             (MAX_CARRIED_OUTCOMES = 12)
Adjudication carry-forward:  applyAdjudicationCarryForward (OPT-IN seam)
Session-compaction sidecar:  session/models/session-compaction.ts,
                             SessionCompactionStateSchema version 1,
                             source_message_count / source_prefix_hash
Provider-message build:      session/services/message-builder.ts
                             MessageBuilder.buildForApi
Cancellation:                context.abortSignal; isCompactionCancellation
Timeout:                     the compaction seam has no per-call deadline of
                             its own; the provider transport does
```

## G0 exit

```text
GO_ENTRY_FROZEN
```
