# Installed qualification — ACT-CLINEMM-BEFOREMODEL-OPERATOR-CHECKPOINT-01

**Target:** `codium-roz` (VSCodium)

The qualification levels are recorded separately and are NOT promoted into one another.

| Level | State | Basis |
|---|---|---|
| `SOURCE_TESTED` | **ACHIEVED** | 30/30 focused + 19/19 webview tests; extension and webview typechecks at 0 diagnostics; full-suite comparison against a HEAD baseline shows 169 → 169 failed tests and 5974 → 6004 passed (+30 = exactly the new tests), i.e. **zero new regressions** |
| `BUILT` | **ACHIEVED** | `bun run build:webview` (8937 modules transformed) and `bun esbuild.mjs --production` both exit 0; the bundle contains the checkpoint code |
| `INSTALLED` | **ACHIEVED** | the VSIX was installed and the installed bytes carry the checkpoint code; the installed bundle SHA-256 is **identical** to the built bundle and to the VSIX-embedded bundle, binding source → build → VSIX → installed |
| `LIVE_PROVIDER_OBSERVED` | **NOT ACHIEVED** | no live provider request was captured (see "Live provider request capture" below) |

**Therefore the ACT verdict is `PASS_STRUCTURAL_ONLY`, NOT full `PASS`.** The exit criteria that
require a live provider request containing the expected checkpoint, and a fresh-window UI
save/reload/display round-trip, are **unverified**.

## Identity

| Item | Value |
|---|---|
| Source HEAD (this ACT) | `bb54f0fa55279557aba298d71e3370c7fa6ed814` |
| Predecessor HEAD | `0b6b3ba51` |
| Package name | `clinemm` |
| Package version | `4.1.26` |
| VSIX path | `dist/clinemm-4.1.26-bb54f0fa5.vsix` (repo root) |
| VSIX byte count | `65609737` |
| VSIX SHA-256 | `566571bedeb748caaaa385b8ae33de0d96a47b61892111bf19f5d9e2903e9e1f` |
| Installed extension version | `4.1.26` (`s1onique.clinemm-4.1.26`) |
| Installed extension directory | `<repo>/.vscodium-roz-ext/s1onique.clinemm-4.1.26` |
| Installed bundle SHA-256 | `ae823a5243b07310c7594faff6bb9d936848121146a8528a9e1fd891d5b27993` |
| Built bundle SHA-256 | `ae823a5243b07310c7594faff6bb9d936848121146a8528a9e1fd891d5b27993` |
| VSIX-embedded bundle SHA-256 | `ae823a5243b07310c7594faff6bb9d936848121146a8528a9e1fd891d5b27993` |

All three bundle digests are **equal**, which is the binding between the source HEAD and the
installed runtime.

### Installed-content verification

| Check | Result |
|---|---|
| `before-model-checkpoint` occurrences in the installed `dist/extension.js` | `1` |
| `beforeModelCheckpointEnabled` occurrences in the installed `dist/extension.js` | `5` |
| `Before Model Hook` present in the installed `webview-ui/build/assets/index.js` | yes |

### Installation-target deviation (environment, not code)

The intended target was the `codium-roz` profile `~/.vscodium-roz/extensions`, which already
contained `s1onique.clinemm-4.1.26-0b6b3ba51` (the predecessor HEAD). Installing there failed:

```
Error: Unable to write file '/Volumes/UserData/Users/chistyakov/.vscodium-roz/extensions/.obsolete'
  (NoPermissions (FileSystemError): Error: EPERM: operation not permitted)
```

The cause is a **host sandbox / macOS TCC boundary**, not a defect in the VSIX. The following
paths were all verified NOT writable by the agent process, while the repository path was
writable:

```
/Volumes/UserData/Users/chistyakov/.vscodium-roz    NOT WRITABLE
/Volumes/UserData/Users/chistyakov/.vscodium-roz2   NOT WRITABLE
/Volumes/UserData/Users/chistyakov/.vscode-oss      NOT WRITABLE
/Volumes/UserData/Users/chistyakov/Projects         NOT WRITABLE
<repo>                                               WRITABLE
```

The VSIX was therefore installed into a repo-local extensions directory that mirrors the
`codium-roz` layout, using the same installer and the same VSIX bytes:

```
codium --install-extension <repo>/dist/clinemm-4.1.26-bb54f0fa5.vsix \
        --extensions-dir <repo>/.vscodium-roz-ext --force
→ Extension 'clinemm-4.1.26-bb54f0fa5.vsix' was successfully installed.
```

## Live provider request capture

**NOT CAPTURED.**

The live qualification was not attempted to completion. The known obstacle, documented by the
repository's own prior-ACT harness script
(`apps/vscode/src/dev/debug-harness/live-installed-vsix-qualification.tcrr01.mjs`), is that the
GUI **cannot start on this substrate** — both the branded VS Code and the harness-downloaded VS
Code die with SIGSEGV under the Seatbelt profile (the harness reports `kill EPERM`). A
GUI-driven live run is therefore not possible here, and the established alternative is to drive
the **packaged bundle from the installed VSIX** directly.

That alternative was not completed within this ACT.

Consequently the following remain **unverified**:

1. a fresh-window UI round-trip (paste text → interval 4 → enable → save → reopen → persisted);
2. that a live session's **preceding** requests contain no checkpoint text;
3. that the request following the 4th completed tool-using turn contains the checkpoint text
   **exactly once**;
4. that a fresh session with the feature disabled produces no injection;
5. the model / engine identity used for live qualification.

### Structural evidence that stands in for the live capture

The live-capture requirement is covered structurally by the focused runtime test
(`before-model-operator-checkpoint.runtime.bmoc01.test.ts`), which drives the **REAL**
`AgentRuntime` provider-ready path with a scripted model capturing **EVERY** provider request:

| Assertion | Result |
|---|---|
| the checkpoint appears in the request after the 4th completed tool-using turn | PASS |
| it appears **exactly once** in that request | PASS |
| the preceding requests do **not** contain it | PASS |
| with the feature disabled, the provider requests are **unchanged** | PASS |
| the final request-budget guard still rejects an over-budget request | PASS |

This is **not** a substitute for the live observation and is not recorded as one.
