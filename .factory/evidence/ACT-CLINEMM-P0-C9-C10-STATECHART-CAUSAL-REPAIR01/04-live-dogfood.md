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

(Filled in by the build run — see `06-vsix-identity.txt`.)

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
