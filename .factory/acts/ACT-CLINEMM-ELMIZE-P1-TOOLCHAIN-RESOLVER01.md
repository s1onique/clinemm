# ACT-CLINEMM-ELMIZE-P1-TOOLCHAIN-RESOLVER01

**Status:** PASS_CLINEMM_TOOLCHAIN_RESOLVER (CLOSED)
**Date:** 2026-10-07
**Classification:** P1 — bounded build/toolchain contract defect
**Authority chain:** factory review digest → ELM-toolchain-resolver ACT → dogfood builder re-run → install/LIVE (operator-owned next steps)

---

## Problem statement

The canonical dogfood builder (`scripts/build-dogfood-vsix.py`) creates a fresh detached Git worktree under `git worktree add --detach <HEAD>`. A Git worktree checks out the committed tree for that HEAD; untracked files in the main worktree (including the previously-vendored `apps/vscode/elm/completion-continuation-control/vendor/elm`) are **NOT** part of that checkout.

The completion-continuation-control kernel's `build-elm.sh` required `${HERE}/vendor/elm` to exist; the exact-HEAD worktree does not have it (it is `.gitignored`). Result: the exact-head build halts with `HALT_COMPLETION_CONTINUATION_CONTROL_ELM_KERNEL_NOT_VENDORED`.

Two further contract divergences across the three kernels:
- `completion-authority` ignored `${ELM_BIN}` entirely — it used `command -v elm` on PATH, which on this host resolves to `/run/current-system/sw/bin/elm 0.19.1` (wrong version).
- `task-header-orchestration` ignored `${ELM_BIN}` too — it used `${HERE}/vendor/elm`.

Three kernels, three different toolchain contracts.

---

## Fix contract

A single shared resolver across all three kernels, with explicit precedence:

```text
all Elm kernel build scripts
  -> source scripts/elm_toolchain.sh

resolver precedence (first non-empty wins):
  1. ${ELM_BIN}             -- explicit override, orchestrator-supplied
  2. ${HERE}/vendor/elm     -- canonical existing repo-local compiler
  3. system elm on PATH     -- exact 0.19.2 check guards drift
  4. fail closed            HALT_ELM_TOOLCHAIN_UNRESOLVED / _VERSION_MISMATCH

required version: 0.19.2 (pinned)
```

The orchestrator (`scripts/build_dogfood_vsix_lib.py`) resolves the compiler on the build host via `resolve_elm_compiler()` and passes the resolved path into each kernel's `build-elm.sh` via the `${ELM_BIN}` env var. The compiler identity (`version`, `path`, `sha256`, `resolver_reason`) is stamped into the artifact JSON so the build is reproducible from `(source_head, elm_compiler)` alone.

---

## Files changed (7 files, ~430 insertions, ~55 deletions)

| File | Change |
|---|---|
| `scripts/elm_toolchain.sh` | NEW — shared toolchain authority (150 lines) |
| `scripts/build_dogfood_vsix_lib.py` | NEW `resolve_elm_compiler()` helper + `build_elm_kernel` env propagation + result JSON identity stamping (~180 lines) |
| `apps/vscode/elm/completion-continuation-control/scripts/build-elm.sh` | Sources shared resolver; removed `HALT_COMPLETION_CONTINUATION_CONTROL_ELM_KERNEL_NOT_VENDORED` guard |
| `apps/vscode/elm/task-header-orchestration/scripts/build-elm.sh` | Sources shared resolver (kept `${HERE}/vendor/elm` as branch-2 fallback) |
| `apps/vscode/elm/completion-authority/scripts/build-elm.sh` | Sources shared resolver (was using `command -v elm`, ignoring `${ELM_BIN}`) |
| `apps/vscode/elm/completion-continuation-control/.gitignore` | Comment refreshed to reference the resolver contract (gitignore directives unchanged) |
| `scripts/tests/test_elm_toolchain_resolver.py` | NEW — 13 tests pinning the shell + Python resolver contracts |

---

## Conservation gates

| Gate | Result |
|---|---|
| `python3 -m unittest scripts.tests.test_elm_toolchain_resolver` | **13/13 PASS** |
| `python3 -m unittest scripts.tests.test_build_dogfood_vsix` (with my changes) | 57/67 (10 pre-existing failures — see Notes) |
| `python3 -m unittest scripts.tests.test_build_dogfood_vsix` (at HEAD `dc0da47cf` without my changes, via `git stash`) | 57/67 (same 10 failures) |

The 10 pre-existing failures all stem from the third kernel `completion-continuation-control` being added to `_ELM_KERNELS` in `dc0da47cf` (CORRECTION06) without updating the test stub seeds. **Zero regression from this ACT.**

---

## Reproducibility signal (operator-supplied)

```
$ /opt/homebrew/bin/elm --version
0.19.2

$ shasum -a 256 /opt/homebrew/bin/elm
3e65ac3e2817b89530775fc6664bc20fd7e7c5cd041bbb09eba5722a1037dc8b  /opt/homebrew/bin/elm
```

The SHA matches `apps/vscode/elm/completion-continuation-control/vendor/elm.sha256` line 2: `3e65ac3e2817b89530775fc6664bc20fd7e7c5cd041bbb09eba5722a1037dc8b  vendor/elm (decompressed binary, post-gunzip)`.

The official homebrew `elm` formula packages the same binary that was previously vendored. Toolchain identity is now a single OS-level binary install rather than three 60 MB tracked blobs.

---

## Notes (operator-facing)

1. **Pre-existing baseline failures in `test_build_dogfood_vsix`** (10 tests): `_write_tracked_elm_sources` and `_make_vsix` fixtures were written for 2 kernels; the recent CORRECTION06 commit added the third kernel. A trivial follow-up ACT can update the stubs.
2. **Why `/opt/homebrew/bin/elm` is preferred over `shutil.which`**: this build host has two elms on different PATH slots — `/run/current-system/sw/bin/elm 0.19.1` (Nix) and `/opt/homebrew/bin/elm 0.19.2` (homebrew). Without the explicit homebrew-slot check, `shutil.which` would resolve to the Nix-system 0.19.1 and silently violate the kernel ABI pin.
3. **Why the `${ELM_BIN}` override is AUTHORITATIVE**: if the operator pins a wrong-version compiler via `ELM_BIN`, the resolver refuses to substitute a different compiler. Falling through would defeat the pinning intent.
