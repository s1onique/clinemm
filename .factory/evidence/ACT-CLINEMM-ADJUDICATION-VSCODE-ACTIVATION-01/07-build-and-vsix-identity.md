# 07 — Build and VSIX identity (G8)

**ACT:** ACT-CLINEMM-ADJUDICATION-VSCODE-ACTIVATION-01
**Classification:** REAL

## G8 — Executable gates

All commands were run from the repository with the locally installed Bun
toolchain (`/opt/homebrew/bin/bun`, Bun 1.3.14; Node v26.0.0).

| # | Gate | Command | Exit | Result |
|---|---|---|---|---|
| 1 | Focused VS Code activation tests | `cd apps/vscode && bunx vitest run --config vitest.config.ts src/sdk/__tests__/adjudication-vscode-activation01.test.ts` | 0 | 5/5 PASS |
| 1b | Runtime-chain tests | `cd apps/vscode && bunx vitest run --config vitest.config.c2-4-c-bridge.ts src/sdk/__tests__/adjudication-vscode-activation01.runtime-chain.c24-c-bridge.test.ts` | 0 | 13/13 PASS |
| 2 | Core adjudication / provenance tests | `cd sdk/packages/core && bunx vitest run --config vitest.config.ts src/extensions/context/compaction.adjudication-provenance.correction01.test.ts src/extensions/context/compaction.adjudication-output-contract.implement01.test.ts` | 0 | 78/78 PASS |
| 3 | Existing compaction context tests | (covered by gate 2 — the compaction suites are the compaction context tests) | 0 | PASS |
| 4 | VS Code typecheck | `cd apps/vscode && bunx tsc --noEmit` | 0 | 0 diagnostics |
| 4b | VS Code bridge typecheck | `cd apps/vscode && bunx tsc -p tsconfig.c2-4-c-bridge.json --noEmit` | — | 5 diagnostics, **identical to the ENTRY_HEAD baseline** (measured by stashing the ACT's changes: the same 5, in the same files, with the same codes). **0 ACT-owned diagnostics.** |
| 4c | SDK core typecheck | `cd sdk/packages/core && bun run typecheck` | — | 44 diagnostics before the ACT, 44 after. **0 ACT-owned diagnostics.** |
| 5 | Biome on the changed files | `cd apps/vscode && bunx biome lint --config-path ./biome.jsonc --no-errors-on-unmatched --files-ignore-unknown=true --diagnostic-level=error <9 changed files>` | 0 | "Checked 9 files … No fixes applied." |
| 5b | Biome format | `cd apps/vscode && bunx biome format --config-path ./biome.jsonc --changed --since main … --semicolons=as-needed` | 0 | PASS |
| 6 | Source / build artifact verification | see below | 0 | PASS |
| 7 | The original historical RED remains isolated and unchanged | `cd sdk/packages/core && bunx vitest run --config vitest.red.adjudication-continuity-red01.config.ts` | 1 | **5 failed / 5** — the historical RED is intact and unchanged |

### The broader-suite regression comparison

The broader base suite contains pre-existing failures. Per the ACT's
instruction, failure IDENTITIES were compared rather than requiring
unrelated baseline failures to disappear.

```
BASELINE (ENTRY_HEAD producer, ACT's changes stashed):
  Test Files  65 failed | 477 passed | 6 skipped (548)
  Tests      171 failed | 6010 passed | 60 skipped (6241)

AFTER (with the ACT's implementation):
  Test Files  63 failed | 478 passed | 6 skipped (547)
  Tests      169 failed | 6012 passed | 60 skipped (6241)
```

The failing-test-identity diff:

```
--- NEW failing test identities (regressions) ---
(none)

--- FIXED (present in baseline, gone now) ---
src/sdk/__tests__/adjudication-vscode-activation01.runtime-chain.c24-c-bridge.test.ts [ ... ]
src/sdk/__tests__/adjudication-vscode-activation01.test.ts > ... > carries the authorized contract into the produced CoreSessionConfig
src/sdk/__tests__/adjudication-vscode-activation01.test.ts > ... > supplies a revision resolver that fails closed outside the workspace
```

**ZERO regressions.** The only changed identities are the ACT's OWN tests,
which failed in the baseline (no wiring) and pass after the implementation.

The suite also REPAIRED one pre-existing failure: the RBE01 config-contract
invariant "every bridge tsconfig include is in the BRIDGE vitest include"
now passes, because the ACT's test was added to BOTH sides of the existing
bridge vitest/tsconfig pair.

## Packaging

The repository's normal pipeline was used:

```bash
cd apps/vscode
bun run build:webview          # -> bun run protos && cd webview-ui && bun run build
bun esbuild.mjs                # the extension bundle
mkdir -p ../../dist            # REQUIRED: vsce stats the --out path before writing
node_modules/.bin/vsce package --no-dependencies \
  --out ../../dist/clinemm-4.1.26-7490a12a5-av01.vsix
```

`vsce package` runs the `vscode:prepublish` hook, which re-ran
`bun run package` (typecheck → webview build → lint → production esbuild).
The bundle that landed in the VSIX is therefore the PRODUCTION build.

### The recorded identities

```
SOURCE_HEAD:              7490a12a58fbec73800f97c4b2346bde6b394725
SOURCE_VERSION:           4.1.26
VSIX_PATH:                dist/clinemm-4.1.26-7490a12a5-av01.vsix
VSIX_BYTES:               65046373
VSIX_SHA256:              5b5fc383649a067968cabf986ff5fa89af4d8dd990822b32ce9687efe8a96d1a
BUNDLED_EXTENSION_SHA256: ab9bb821cf16a09c31b07447a72e4839719763bf75639a0c0b3e79dc5217c96d
INSTALLED_VERSION:        4.1.26-613295a95
INSTALLED_BUNDLE_SHA256:  0b0c5828b44a12928bc9e78c1f250c50c7166bc4e7415825cd0bd7f9bd9dcea5
```

### The VSIX's ACTUAL embedded bundle was inspected

The brief requires inspecting the artifact, not trusting the source. The
VSIX was unzipped and the embedded bundle was hashed and probed directly:

```bash
unzip -o -q dist/clinemm-4.1.26-7490a12a5-av01.vsix 'extension/dist/extension.js' -d /tmp/av01-vsix
shasum -a 256 /tmp/av01-vsix/extension/dist/extension.js
# ab9bb821cf16a09c31b07447a72e4839719763bf75639a0c0b3e79dc5217c96d
```

The embedded bundle's SHA-256 is **byte-identical** to the locally built
bundle. The ACT's code is present in it, verified with MINIFICATION-SAFE
markers (the class names are mangled by esbuild, so string literals and
method names were used):

| Marker | Occurrences in the VSIX bundle |
|---|---|
| `adjudicationSessionSecrets` (the new secret key) | 2 |
| `consumeForSession` (the store's consumption method) | 2 |
| `peekArmed` (the store's pure read) | 5 |

And the PRODUCER WIRING itself is in the bundle:

```
n7i=class{armed;bound;arm(e){this.armed=e}hasArmed(){return this.armed!==void 0}
peekArmed(){return this.armed}consumeForSession(e){...}}

... u=x.sessionId?.trim()||WA(),hOr().consumeForSession(u), ...
```

The second fragment is the coordinator's consumption at the authoritative
session-id allocation point (`taskSessionId = ... ; getAdjudicationTaskContractStore().consumeForSession(taskSessionId)`).

The `SECRETS_KEYS` array in the bundle ends with
`...,"wandbApiKey","adjudicationSessionSecrets"]` — the new secret key is
registered.

## The installed extension was NOT overwritten

`vsce package` only WRITES the `.vsix`; it does not touch the installed
extension directory. The installed artifact is unchanged and still verifies:

```
INSTALLED_BUNDLE_SHA256: 0b0c5828b44a12928bc9e78c1f250c50c7166bc4e7415825cd0bd7f9bd9dcea5
```

### The rollback path

- The installed extension directory
  `~/.vscodium-roz/extensions/s1onique.clinemm-4.1.26-613295a95/` is
  INTACT and still byte-identical to its original state.
- The ACT's VSIX has a DIFFERENT filename and a DIFFERENT bundle hash, so
  it cannot silently replace the known-good installed build.
- Restoring the known-good state is a single directory operation: remove
  the newly installed extension directory and the original one is still
  there. No destructive action was taken by this ACT.

### The artifact-identity relationship

```
installed bundle  0b0c5828...  <- build of sourceHead 613295a95  (PRE-ACT)
VSIX bundle       ab9bb821...  <- build of sourceHead 7490a12a5 + the ACT's delta
```

The two are DIFFERENT, and the ACT's bundle is the one that contains the
activation. This is the expected relationship: the ACT is not yet installed
into `codium-roz`. See `08-installed-live-qualification.md` for the
consequence.
