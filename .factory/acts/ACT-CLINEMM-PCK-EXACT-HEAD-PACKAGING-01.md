# ACT-CLINEMM-PCK-EXACT-HEAD-PACKAGING-01

```text
STATUS:   IN_PROGRESS — C1 and C2 COMPLETE, C3+ NOT EXECUTED
VERDICT:  (packaging deferred by operator instruction)
ENTRY:    014cbdcbc41c660095989e3cbd515c81b6f84933
SUBJECT:  b8f6efee6d87509589b9760bc42c9ce0d6847eff
SCOPE:    C0 entry identity; C1 bounded P1 preflight; C2 freeze the
          artifact source. Then build, package, and verify the artifact.
NOT DONE: C3 build, C4 artifact identity, C5 full closure. The operator
          directed that nothing be built, so the packaging stages were
          not executed.
```

## Why this ACT existed

The CORRECTION02 review returned `GO_PACKAGING` **with one bounded P1
check** before packaging. The review required that the packaged artifact
be bound to the reviewed implementation, and that the remaining
implementation-contract concern be settled first.

## C0 — entry identity

```text
HEAD:    b8f6efee6d87509589b9760bc42c9ce0d6847eff
BRANCH:  main
TRACKED: CLEAN
STASH:   none
UNTRACKED: only the five KNOWN EXEMPT paths carried forward untouched
           from earlier ACTs
```

No unexpected tracked dirt. The known exempt untracked files were
preserved and NOT staged.

## C1 — the bounded P1 preflight

### The production schema, INSPECTED

```text
sdk/packages/core/src/extensions/tools/schemas.ts

  RunCommandsInputSchema  (the CANONICAL, strict run_commands shape)
      { commands: string[], notifyOnCompletion?: boolean }
    .strict()

  ReadFilesInputSchema
      { files: ReadFileRequest[] }
```

The canonical history representation, from the production fixtures:

```text
sdk/packages/core/src/extensions/context/evidence-continuity.test.ts
  toolCall("call_a", "run_commands", { commands: ["helm template"] })
```

### The concern was SUBSTANTIATED

CORRECTION02 walked a GLOBAL key list:

```text
command, commands, query, script, path, file_path, filePath
```

`path`, `file_path` and `filePath` are the READ-REQUEST fields of the
production `read_files` schema. `query` and `script` are not
authoritative executable-command fields of the production `run_commands`
schema either.

The consequence was a FALSE ASSURANCE: a `read_files` call whose FILE
PATH was the string "make build" was classified as a BUILD INVOCATION
and reached `tool_observed`. A file named "make build" is not a
command, and a command is never inferred from a path.

### The RED

```text
3 failed | 5 passed (9 tests)
  expected [ 'make build' ] to deeply equal []
  expected 'tool_observed' to be 'model_reported'
```

### The correction — the smallest conservative change

```ts
export const COMMAND_EXECUTION_INPUT_FIELDS: Readonly<
	Record<string, readonly string[]>
> = Object.freeze({
	run_commands: Object.freeze(["commands", "command", "cmd"]),
});
```

The key walk is now SCOPED TO THE TOOL, using the PRODUCTION schema's
own boundary rather than a global list. The CLASSIFICATION itself is
UNCHANGED: `classifyCommand()` still does the work; this table only
decides WHICH VALUES are eligible to be classified. A tool that is not
listed contributes NO classification at all.

No new classifier. No vocabulary expansion. No architecture change.

### The semantic boundary

The review noted that invoking `make build` does not necessarily
establish that a build occurred or that an artifact was produced. The
published statement was already correctly scoped — it renders
"operation invoked with argument: build", which names the INVOCATION
and claims no outcome — and this is now asserted explicitly (P1.9).

### The model-qualification script

The CORRECTION01 model-gate script did not appear in the CORRECTION02
changeset, and its secondary gate evaluation did not forward the
selected argument, so it computed the assurance bound against a
DIFFERENT proposition than the one `runPckAttempt()` publishes. It now
forwards the argument exactly as the production attempt does.

### The measurements

```text
ACT-OWNED FOCUSED SUITE (10 files)         90 passed
CONTEXT SUITE                              922 passed, 2 skipped
RUNTIME/ORCHESTRATION SUITE                250 passed
TYPECHECK                                  44 diagnostics (the baseline)
                                           ACT_OWNED_DIAGNOSTICS=0
                                           the diagnostic set is BYTE-IDENTICAL
                                           to the baseline
LINT/FORMAT                                biome check clean

PCK_EXECUTION_AUTHORITY_PREFLIGHT=PASS
```

## C2 — the artifact source freeze

```text
ENTRY_HEAD          = 014cbdcbc41c660095989e3cbd515c81b6f84933
SUBJECT_HEAD        = b8f6efee6d87509589b9760bc42c9ce0d6847eff
DOGFOOD_SOURCE_HEAD = b8f6efee6d87509589b9760bc42c9ce0d6847eff
EXTENSION_NAME      = clinemm
EXTENSION_VERSION   = 4.1.26
EXTENSION_PUBLISHER = s1onique
EXTENSION_ID        = s1onique.clinemm
```

The `SUBJECT_HEAD` was DISCOVERED, not predicted.

The default-off configuration is CONFIRMED unchanged:
`CLINEMM_PCK_CLOSED_ENABLED` must be exactly "1" or "true".

### A material fact discovered at the freeze

The extension bundles `@cline/core` from its COMPILED `dist/`, and the
currently present build product is STALE with respect to BOTH reviewed
corrections:

```text
$ grep -c "COMMAND_EXECUTION_INPUT_FIELDS"           sdk/packages/core/dist/index.js
0
$ grep -c "RUNTIME_ARGUMENT_EVIDENCE_CLASSIFICATIONS" sdk/packages/core/dist/index.js
0
```

So the packaging stage MUST regenerate the SDK before packaging. The
established workflow, discovered from the repository's prior packaging
receipts, is:

```text
1. bun run build:sdk
2. cd apps/vscode && bun run protos && bun esbuild.mjs --production
3. cd apps/vscode && bunx --bun vsce package --no-dependencies \
       --out ../../dist/clinemm-<version>-<short-head>.vsix
```

This ACT did NOT execute these stages: the operator directed that
nothing be built. The discovery is recorded so the step is not skipped
by mistake, and so no one assumes the present `dist/` is authoritative.

## What is NOT done

```text
BUILD=PASS                             NOT_EXECUTED
PACKAGE=PASS                           NOT_EXECUTED
ARTIFACT_SOURCE_BINDING=PASS           NOT_EXECUTED
VSIX_IDENTITY=VERIFIED                 NOT_EXECUTED
EMBEDDED_BUNDLE_IDENTITY=VERIFIED      NOT_EXECUTED
DEFAULT_OFF=CONFIRMED                  CONFIRMED (read-only, unchanged)
INSTALLED_LIVE=NOT_EXECUTED
CONVERGENCE_IMPROVEMENT=NOT_ESTABLISHED
```

No build, no package, no install, no live task, no release publication.

## The evidence corrections carried from the CORRECTION02 review

Five report statements are corrected verbatim in
`.factory/evidence/ACT-CLINEMM-PCK-EXACT-HEAD-PACKAGING-01/03-evidence-corrections-non-blocking.md`,
most notably: FIVE (not six) same-class counterexamples were new
discriminator assertions — the directory-listing negative control
already passed against CORRECTION01; and the "11 RED failures" were
NINE assertion failures and TWO missing-export errors.

The residue is batched for terminal cleanup. LEAMAS is left alone. A10
and B06 are untouched.

