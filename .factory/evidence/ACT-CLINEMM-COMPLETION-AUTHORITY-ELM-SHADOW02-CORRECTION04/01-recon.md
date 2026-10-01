# CORRECTION04 recon

## Reviewer finding (P1)

CORRECTION03 (PACKAGING-DISCOVERY) added `stage_elm_kernel_runtime_asset()`
to sidestep vsce's `.gitignore`-before-`.vscodeignore` precedence
problem: the staging helper copies the Elm kernel from the
nested-gitignored `elm/completion-authority/vendor/` directory into a
non-gitignored, package-owned `runtime-assets/` directory immediately
before `vsce package`.

The first live dogfood run reproduced a NEW failure surface: the
staging helper raised `BuildError: Elm kernel source missing in
worktree: …`. The canonical TS/webview/lint/esbuild build succeeded;
only the staging step failed because the source kernel bytes were
absent from the staged worktree.

## Causal analysis (reviewer-supplied)

A git linked worktree is a checkout of the chosen commit, not a copy
of arbitrary generated / ignored files from the main working tree.
The `apps/vscode/elm/completion-authority/vendor/*.js` artifacts are
gitignored (`apps/vscode/elm/completion-authority/.gitignore`
lines 11-12). The canonical dogfood build (TS/webview/lint/esbuild
via `bun run vscode:prepublish` and the `skip_typecheck` shortcut)
does NOT execute `apps/vscode/elm/completion-authority/scripts/build-elm.sh`.
Therefore the staged worktree's `vendor/` directory contains the
historic `vendor/elm` binary + `vendor/elm.sha256` + `vendor/.gitkeep`
— but NOT the generated `completion-authority.js` and
`completion-authority.js.sha256`. The staging helper correctly failed
closed.

## Bounded fix (reviewer-prescribed, ~5–15 lines)

Add `build_elm_kernel(stage_apps_vscode)` to
`scripts/build_dogfood_vsix_lib.py`. It invokes the tracked
`apps/vscode/elm/completion-authority/scripts/build-elm.sh` with
`cwd=stage_apps_vscode`. The orchestrator wires it BEFORE
`stage_elm_kernel_runtime_asset(stage_apps)`.

Authority boundaries preserved:

1. The tracked `build-elm.sh` is the build authority — the Python
   helper is the orchestrator seam that invokes it. No second Elm
   build implementation in Python.
2. `stage_elm_kernel_runtime_asset` remains the byte/SHA authority
   and the fail-closed contract for downstream verification.
3. Canonical worktree is never touched: the helper operates on
   `stage_apps_vscode`, the temp worktree's apps/vscode directory.
   The worktree's `$(cd "$(dirname ...)")/..` anchor in `build-elm.sh`
   resolves into the staged tree, not the canonical tree.

## Lib changes (the bounded fix)

`build_elm_kernel(stage_apps_vscode, *, run_visible=None)`:

```python
build_script = (
    stage_apps_vscode
    / "elm" / "completion-authority" / "scripts" / "build-elm.sh"
)
if not build_script.is_file():
    raise BuildError(
        f"Elm build script missing in worktree: {build_script} — "
        "is apps/vscode/elm/completion-authority/scripts tracked?"
    )
runner = run_visible or (
    lambda argv, cwd: _default_run(argv, cwd, capture=False)
)
runner([str(build_script)], stage_apps_vscode)
```

Orchestrator wiring (inside the same `try` block, immediately before
the existing CORRECTION03 stage call):

```python
build_elm_kernel(stage_apps, run_visible=run_visible)
stage_elm_kernel_runtime_asset(stage_apps)
```

`build_elm_kernel` added to `__all__` and re-exported from the
test module's import block.

## Tests added (DOGFOOD-KERNEL-05 + KERNEL-05b)

8 new tests, all GREEN:

`TestDogfoodKernel05BuildElmKernel`:

- `test_helper_invokes_tracked_build_elm_script` — argv/cwd pin: only
  one argv element, ends with `…/elm/completion-authority/scripts/build-elm.sh`,
  cwd equals `stage_apps_vscode`.
- `test_helper_fails_closed_when_build_script_missing` — BuildError
  raised before the runner is invoked.
- `test_helper_propagates_build_failure` — runner raises BuildError →
  helper propagates.
- `test_helper_does_not_touch_canonical_repo` — none of the recorded
  (argv, cwd) pairs have cwd inside the canonical repo.
- `test_helper_build_failure_aborts_package` — orchestrator trace
  shows `vsce package` does NOT appear in `visible_trace` after the
  build fails.
- `test_helper_build_occurs_before_stage_in_orchestrator` —
  orchestrator trace shows BUILD-ELM-KERNEL-INVOKED before any
  `vsce package` invocation.

`TestDogfoodKernel05bBuildSuccessMissingArtifactFailsClosed`:

- `test_build_success_no_artifact_still_fails_closed` — staging helper
  is still the authority; a "successful" build that writes nothing is
  still caught by `stage_elm_kernel_runtime_asset`.
- `test_build_success_writes_artifact_staging_passes` — positive
  control: build writes real bytes → staging returns the matching SHA.

## Test-collection audit (CORRECTION-FIX)

The earlier report of "7 new tests, 54/54 PASS" was off-by-one.
`test_helper_build_occurs_before_stage_in_orchestrator` was defined
at module scope (column 0) rather than inside
`TestDogfoodKernel05BuildElmKernel` (column 4). Python's `unittest`
collector does not pick up module-level functions — the test ran
correctly when invoked directly, but the suite collection missed it.
Re-indented the method body by one level (4 spaces) and stripped
the pre-existing trailing whitespace from whitespace-only lines
(220 lines, all inside this ACT's diff region). Now collected:
**6 in KERNEL-05, 2 in KERNEL-05b, 8 total new, 55/55 grand total.**

## Gates GREEN

- `python3 -m unittest scripts.tests.test_build_dogfood_vsix` →
  55 tests, 0 failures, 0 errors. (Was 47; added 8.)
- `python3 -m py_compile` on both files → OK.
- `git diff --check` → clean.
- No new Elm semantics, no new TS authority floor, no new vsce
  authority, no new build implementation in Python.

## Lifecycle: DIRTY_SUBJECT_UNBOUND

`subject_head = PENDING_COMMIT`. This ACT has been authored but
not yet committed. The canonical dogfood run MUST wait until this
ACT is committed and SUBJECT_HEAD is established.

Rationale (per the exact-source-binding invariant D01): the
detached worktree created by `git worktree add --detach` checks out
HEAD. While the working tree is dirty (uncommitted changes to
`scripts/build_dogfood_vsix_lib.py` + `scripts/tests/test_build_dogfood_vsix.py`),
those changes are NOT part of the HEAD the dogfood build binds to.
Running `python3 scripts/build-dogfood-vsix.py` before this commit
would produce an artifact whose claimed source HEAD (the pre-commit
HEAD) does not include the CORRECTION04 fix — defeating D01
EXACT_SOURCE_BINDING.

The bounded fix itself (the production code change) is correct
and ready. The next session must:

1. Commit this ACT (subject_head → real commit SHA).
2. `python3 scripts/build-dogfood-vsix.py --install --force`.
3. Bind source HEAD + version + path + size + SHA-256.
4. Verify installed-version listing.
5. Run LIVE Elm-shadow qualification per the CORRECTION02 steps.

## Verdict

VERDICT=PASS_KERNEL_BUILD_IN_WORKTREE_GREEN
READY_FOR_DOGFOOD_RETRY=true

The bounded fix resolves the next missing contract surfaced by the
CORRECTION03 staging seam: the kernel is now built from the tracked
Elm sources inside the staged worktree immediately before staging.
The canonical worktree is never modified. The `vsce package` step
is reached only when the byte/SHA contract is satisfied by the
staging helper.

Operator can now re-run the canonical dogfood command. If the
operator has Elm 0.19.2 on PATH, the package step runs and the
exact VSIX payload verifier then finally tests CORRECTION03's
packaging-discovery claim. If the operator does NOT have Elm
0.19.2 on PATH, `build_elm_kernel` propagates
`HALT_ELM_VERSION_MISMATCH` from `build-elm.sh` and the package
never starts — exactly the bounded, fail-closed contract.