# 02 — C2 artifact source freeze (read-only)

```text
EXPECTED_ENTRY_HEAD = 014cbdcbc41c660095989e3cbd515c81b6f84933
ENTRY_HEAD          = 014cbdcbc41c660095989e3cbd515c81b6f84933   MATCH
SUBJECT_HEAD        = b8f6efee6d87509589b9760bc42c9ce0d6847eff
DOGFOOD_SOURCE_HEAD = b8f6efee6d87509589b9760bc42c9ce0d6847eff
EXTENSION_NAME      = clinemm
EXTENSION_VERSION   = 4.1.26
EXTENSION_PUBLISHER = s1onique
EXTENSION_ID        = s1onique.clinemm
```

The `SUBJECT_HEAD` was DISCOVERED, not predicted: it is the commit that
carries the C1 execution-authority correction.

## The commit chain

```text
b8f6efee6  ACT-CLINEMM-PCK-EXACT-HEAD-PACKAGING-01: bound the command
           classification to the authoritative execution boundary
014cbdcbc  ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION02:
           eliminate the same-class false observation assurance
5d6ff6e53  ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01-CORRECTION01:
           correct the false observation assurance and close the
           reference confidentiality boundary
a99b7187f  ACT-CLINEMM-PCK-CLOSED-PUBLICATION-IMPLEMENT-01: implement the
           default-off closed pre-compaction knowledge checkpoint
```

## Branch and tree state

```text
Branch:  main
Tracked tree: CLEAN (no tracked dirt at the freeze)
Stashes:      none
```

The only untracked paths are the KNOWN EXEMPT ones, carried forward
untouched from earlier ACTs:

```text
.factory/evidence/ACT-CLINEMM-PCK-OUTPUT-TRUST-BOUNDARY-01/
.factory/evidence/ACT-CLINEMM-PCK-SOURCE-VISIBILITY-DISCRIMINATOR-01/
sdk/packages/core/scripts/source-visibility-discriminator.generate.ts
sdk/packages/core/src/extensions/context/output-trust-boundary/
sdk/packages/core/src/extensions/context/source-visibility-discriminator/
```

## The default-off configuration is UNCHANGED

```text
sdk/packages/core/src/extensions/context/precompaction-knowledge-checkpoint/runtime.ts

  PCK_ENABLE_ENV_VAR = "CLINEMM_PCK_CLOSED_ENABLED"
  isPckClosedEnabled(): the value must be exactly "1" or "true"
  (case-insensitive); anything else leaves the feature OFF.
```

The feature remains DEFAULT-OFF. No packaging step may alter this.

## A MATERIAL FACT DISCOVERED AT THE FREEZE

The extension bundles `@cline/core` from its COMPILED `dist/`, not from
`src/`. The currently present build product is STALE with respect to
both reviewed corrections:

```text
$ grep -c "COMMAND_EXECUTION_INPUT_FIELDS"      sdk/packages/core/dist/index.js
0
$ grep -c "RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS" sdk/packages/core/dist/index.js
0
```

So the packaging stage MUST regenerate the SDK before packaging. The
established workflow is:

```text
1. bun run build:sdk                    (regenerates sdk/packages/*/dist)
2. cd apps/vscode && bun run protos && bun esbuild.mjs --production
3. cd apps/vscode && bunx --bun vsce package --no-dependencies \
       --out ../../dist/clinemm-<version>-<short-head>.vsix
```

This ACT did NOT execute these stages: the operator directed that
nothing be built. The discovery is recorded here so the packaging stage
is not skipped by mistake.
