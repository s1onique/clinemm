# Phase 7 — Exact-head dogfood

## STRUCTURAL EVIDENCE (established)

The structural evidence is the primary evidence of this ACT. It is
labelled separately from the live evidence, per the ACT's requirement.

| Item | Value |
|---|---|
| Repair commit | `a05488988ec1664fd126298ab14e739d5b0b5f45` |
| Repair commit subject | `feat(clinemm): ACT-CLINEMM-P0-C9-C10-STATECHART-CAUSAL-REPAIR01 — retract the completion-authority marker when the C10 commit is withheld` |
| Production files changed | 1 — `apps/vscode/src/sdk/sdk-session-event-coordinator.ts` |
| New test files | 2 — 5 RED/GREEN witnesses + 14 conservation tests |
| New documentation | `docs/architecture/task-lifecycle/` (4 charts + `transitions.tsv` + README) |
| New tooling | `tools/lifecycle-replay/` (offline trace-to-Mermaid projection) |
| Typecheck | clean (`tsc --noEmit`, 0 errors) |
| Lint | clean (`biome lint --diagnostic-level=error` + proto lint) |
| Regression | 163 relevant test files, before/after with the identical list — ZERO new failures |

## The exact-head dogfood build

The VSIX was built by `scripts/build-dogfood-vsix.py`, which builds at
EXACT HEAD in a detached worktree (`D04 ISOLATED_BUILD`), with the
frozen lockfile (`D05 LOCKFILE_AUTHORITY`), and verifies the embedded
manifest version against the derived dogfood version (`D07` /
`D08 PACKAGE_VERIFICATION`).

### The sandbox adaptations this environment required

Four environment limitations had to be worked around. Each is
recorded here because they affect REPRODUCIBILITY of the artifact, and
each is an ENVIRONMENT limitation, not a source change:

| # | Limitation | Evidence | Adaptation |
|---|---|---|---|
| 1 | `bun install` cannot use the default temp dir | `error: PermissionDenied accessing temporary directory. Please set $BUN_TMPDIR or $BUN_INSTALL` | `BUN_INSTALL=/tmp/bun-tmp`, `BUN_TMPDIR=/tmp/bun-tmp`, `TMPDIR=/tmp` |
| 2 | `better-sqlite3@12.11.1`'s native `install` script cannot run | `gyp: No Xcode or CLT version detected!` — the macOS CLT receipts (`/var/db/receipts/com.apple.pkg.CLTools_*`) do not exist on this machine | `bun install --ignore-scripts` + copy the repository's PREBUILT `better_sqlite3.node` (same package version) into place. The build input authority (the frozen lockfile) is unchanged. |
| 3 | The Elm package registry is not writable | `elm: ~/.elm/0.19.2/packages/lock: openFdAt: permission denied` | `ELM_HOME=/tmp/elmhome` (the registry copied verbatim) |
| 4 | The system `elm` is 0.19.1; the kernels require 0.19.2 | `HALT_ELM_TOOLCHAIN_VERSION_MISMATCH: fatal: expected elm 0.19.2, got 0.19.1` | `ELM_BIN=<repo>/apps/vscode/elm/completion-authority/vendor/elm` (the repo's vendored 0.19.2 binary; all three kernels vendor the same 0.19.2 build) |

Adaptation 2 is the only one that touches the BUILD OUTPUT rather than
just the build environment; it substitutes an IDENTICAL prebuilt
native binary for the one the install script would have produced. The
`better-sqlite3` version and its binary are byte-identical to the
repository's own.

### The artifact

The build SUCCEEDED (`EXIT=0`) and produced:

```
clinemm-4.1.16-5a1c485cb-e81c6743f.vsix
  source_head  : e81c6743f294f0de5f3d3deb15b6f828461e389e
  bytes        : 44031692
  sha256       : da9a8e542c76aaaa9dfabedf9d602223f657b2f7f9cc95e3e4ab623d27615b8f
  skip_typecheck : false   (the full-project tsc --noEmit gate RAN and PASSED)
  elm_version  : 0.19.2
```

Full identity in `06-vsix-identity.txt`. The artifact is committed under
this evidence directory.

### The repair is IN the artifact (verified)

`extension/dist/extension.js` was extracted from the built VSIX and
grepped. All three repair symbols are present in the SHIPPED bundle:

```
Retracted the completion-authority marker : 1 occurrence
retractCompletionAuthorityMarker          : present
publishedAuthoritativeCompletionRow       : present
emitHookMessage                           : present
```

### The install (verified)

```
Extension 'clinemm-4.1.16-5a1c485cb-e81c6743f.vsix' was successfully installed.
```

Installed as `s1onique.clinemm-4.1.16-5a1c485cb-e81c6743f`, and the
INSTALLED `extension/dist/extension.js` was re-verified to contain the
retraction seam.

The canonical dogfood profile (`~/.vscodium-clinemm`) is READ-ONLY in
this sandbox (`EPERM: operation not permitted, mkdir
'/Volumes/UserData/Users/chistyakov/.vscodium-clinemm/User'`), so the
install was performed against a writable profile at
`/tmp/dogfood-profile`. This is the same environment condition the
predecessor `ACT-CLINEMM-BCB-CAPTURE01` recorded as
`LIVE_QUALIFICATION_BLOCKED_BY_ENV`.

## LIVE EVIDENCE (pending)

The live qualification requires:

- One real task with HELD terminal observations, run against the
  installed exact-head VSIX, with the diagnostics dumped.

The evidence the run must produce:

```
Final C9
BCB hold/release
Elm decision
C10 commit
Message authority framing
Legacy phase
TaskHeader phase
Footer action
```

and the pass condition:

> A genuinely completed task transitions to Completed exactly once, and
> a still-held task does NOT claim completion.

### Status in this environment

The build and install path were exercised. The LIVE TASK itself was
NOT run in this session, for the following reasons, each verified
rather than assumed:

1. **No LLM provider credential is configured in this sandbox.** A live
   Cline task requires a working provider credential to produce a
   completion tool call at all. Without one the run cannot reach the
   `content_end` seam that the defect lives on.
2. **The dogfood extension install target and the diagnostic dump
   require a writable dogfood profile**, which the prior
   `ACT-CLINEMM-BCB-CAPTURE01` already recorded as
   `LIVE_QUALIFICATION_BLOCKED_BY_ENV` for this class of run.

The STRUCTURAL evidence is complete and the LIVE evidence is
explicitly PENDING — it is not claimed.

## Verdict contribution

`PASS_STRUCTURAL_PENDING_LIVE`.

The defect is causally classified, repaired at a single proven
boundary, proven necessary by ablation on the VISIBLE STATE, and
covered by 19 real-seam tests with zero regressions across 163
relevant test files. The live run is the remaining item.
