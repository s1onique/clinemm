#!/usr/bin/env python3
"""ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01 — testable library.

All orchestration logic for the dogfood VSIX builder lives here. The
companion CLI ``build-dogfood-vsix.py`` is a thin shim over
:func:`build_dogfood_vsix`. Keeping the logic here makes the invariants
D01..D12 unit-testable in isolation (see
``scripts/tests/test_build_dogfood_vsix.py``) without requiring a real
``bun`` / ``vsce`` / VS Code install.

Invariant map (D01..D12 from the ACT brief):
    D01 EXACT_SOURCE_BINDING        enforced in ``build_dogfood_vsix``
                                    via captured ``HEAD`` and the
                                    ``--short=9`` derivation.
    D02 CLEAN_SOURCE_ONLY           :func:`assert_clean_worktree`
                                    raises ``BuildError`` on any
                                    tracked or untracked change.
    D03 SOURCE_IMMUTABILITY         source ``package.json`` is never
                                    touched; only the stage's
                                    ``package.json`` is patched.
                                    :func:`read_package_version` /
                                    :func:`write_package_version` are
                                    exclusively stage-scoped.
    D04 ISOLATED_BUILD              :func:`create_detached_worktree`
                                    builds at exact ``HEAD`` in a
                                    :class:`tempfile.TemporaryDirectory`
                                    which is torn down in
                                    :func:`remove_worktree_quietly`.
    D05 LOCKFILE_AUTHORITY          caller invokes
                                    ``bun install --frozen-lockfile``
                                    inside :func:`run_canonical_build`.
    D06 CANONICAL_BUILD             :func:`run_canonical_build` runs
                                    ``bun run build:sdk`` then
                                    ``bun run vscode:prepublish``.
    D07 PACKAGE_VERSION             :func:`derive_dogfood_version`
                                    produces ``X.Y.Z-<9charsha>``.
    D08 PACKAGE_VERIFICATION        :func:`verify_vsix_manifest`
                                    compares the embedded
                                    ``extension.vsixmanifest`` ``Version``
                                    attribute to the expected dogfood
                                    version.
    D09 PAYLOAD_SANITY              :func:`verify_vsix_payload`
                                    asserts ``extension/dist/extension.js``
                                    and the webview assets directory
                                    are present.
    D10 ARTIFACT_IDENTITY           :func:`finalize_artifact` writes
                                    ``<output_dir>/<name>-<dogfood_version>.vsix``
                                    and computes its SHA-256.
    D11 OPTIONAL_INSTALL            :func:`verify_install_listing`
                                    confirms the post-install list
                                    contains the expected
                                    ``<ns_name>@<dogfood_version>``.
    D12 CLEANUP                     :func:`remove_worktree_quietly`
                                    is invoked from the orchestration
                                    top-level ``finally`` and tolerates
                                    mid-pipeline failures.

The pinned ``@vscode/vsce`` binary path is resolved from the staged
worktree's ``apps/vscode/node_modules/.bin/vsce`` (the lockfile-pinned
copy), never via ``bunx @vscode/vsce`` (which would let network
resolution drift across builds). See :func:`find_vsce_binary`.

Reproducibility contract
------------------------

What D01..D12 prove about this builder:

    REPRODUCIBLE_PROVENANCE=true

    * Source identity is exact: HEAD, short SHA, source manifest
      bytes, and source-tree porcelain state are all snapshotted
      and verified post-build (DOGFOOD03, DOGFOOD03b).
    * Dependency authority is locked: ``bun install --frozen-lockfile``
      and the lockfile-pinned ``node_modules/.bin/vsce`` mean the
      build inputs are deterministic.
    * VSCE authority is locked: the build never shells out to
      ``bunx @vscode/vsce``; it uses the lockfile-determined copy.
    * Artifact verification is locked: the embedded VSIX manifest
      ``Version`` and required payload entries are both asserted.
    * Cleanup is deterministic: the worktree+tempdir are torn down
      even on the failure path.

What this builder does NOT prove (separate evidence required):

    BIT_REPRODUCIBLE_VSIX=NOT_PROVEN

    * Building HEAD twice in two fresh isolated worktrees and
      comparing the resulting artifact hashes is a separate test we
      have not run. VSIX packaging can incorporate archive metadata,
      timestamps, host tool versions, or generated-bundle
      nondeterminism that pinning the JS dependency graph alone
      does not address.
    * If we ever care, it is its own small ACT: ``build HEAD twice,
      sha256(A) == sha256(B)``, ideally repeated across machines.
"""
from __future__ import annotations

import errno
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Callable, Iterable, Optional, Sequence


# =============================================================================
# Errors
# =============================================================================


class BuildError(RuntimeError):
    """Raised for any precondition violation, packaging failure, or
    post-build verification mismatch. The CLI maps this to exit code 2."""


# =============================================================================
# Pure helpers (DOGFOOD-testable without Bun / VSCE side-effects)
# =============================================================================


def derive_dogfood_version(source_version: str, short_sha: str) -> str:
    """Return ``f"{source_version}-{short_sha}"``. Used by DOGFOOD02.

    Pure — no IO, no string mutation of the source version.
    """
    if not source_version:
        raise BuildError("source version is empty")
    if not short_sha:
        raise BuildError("short SHA is empty")
    return f"{source_version}-{short_sha}"


def read_package_version(package_json: Path) -> str:
    """Read the ``version`` field from a package.json. Pure (file IO
    only, no mutation). DOGFOOD03 uses this to assert the source
    manifest's value before any stage work is done."""
    try:
        data = json.loads(package_json.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read {package_json}: {exc}")
    version = data.get("version")
    if not isinstance(version, str) or not version:
        raise BuildError(f"version missing or empty in {package_json}")
    return version


def write_package_version(package_json: Path, version: str) -> None:
    """Write the ``version`` field of a package.json, preserving all
    other keys and the file's trailing newline shape. Used on the
    *staged* manifest only — DOGFOOD04 / DOGFOOD04b.

    ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01-CORRECTION01 (P0):
    fail closed if the staged manifest is missing. A missing
    ``apps/vscode/package.json`` in a detached worktree is a hard
    error condition (wrong worktree, wrong repo layout, failed
    checkout, bad path, corrupted subject) — the build must stop at
    the first broken authority rather than manufacture a stub and
    push on. Tests must create realistic staged fixtures; this is
    NOT a convenience for synthesising empty worktrees.
    """
    if not package_json.is_file():
        raise BuildError(
            f"staged package.json missing: {package_json} — "
            "refusing to fabricate a manifest for a release build"
        )
    try:
        data = json.loads(package_json.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildError(f"cannot read {package_json}: {exc}")
    data["version"] = version
    try:
        package_json.write_text(json.dumps(data, indent=2) + "\n")
    except OSError as exc:
        raise BuildError(f"cannot write {package_json}: {exc}")


def short_sha_from_head(repo: Path, *, run_cmd: Optional[Callable[[Sequence[str], Path], str]] = None) -> str:
    """Return ``git rev-parse --short=9 HEAD``. The only IO is the git
    invocation, which can be swapped for a test double via ``run_cmd``."""
    runner = run_cmd or _default_run
    return runner(["git", "rev-parse", "--short=9", "HEAD"], repo)


def full_sha_from_head(repo: Path, *, run_cmd: Optional[Callable[[Sequence[str], Path], str]] = None) -> str:
    """Return ``git rev-parse HEAD`` (full SHA). Same test-double
    protocol as :func:`short_sha_from_head`."""
    runner = run_cmd or _default_run
    return runner(["git", "rev-parse", "HEAD"], repo)


def assert_clean_worktree(
    repo: Path,
    *,
    status_output: Optional[str] = None,
) -> None:
    """Fail-closed clean-tree check. DOGFOOD01.

    Pass ``status_output`` from a test (or any pre-computed
    ``git status --porcelain`` string). Empty/whitespace = clean;
    anything else = dirty = BuildError.
    """
    if status_output is None:
        status_output = _default_run(
            ["git", "status", "--porcelain=v1", "--untracked-files=all"], repo
        )
    if status_output.strip():
        raise BuildError(
            "source worktree is dirty; commit/stash first:\n" + status_output
        )


def assert_clean_worktree_equal(
    repo: Path,
    *,
    expected_status: str,
    run_cmd: Optional[Callable[[Sequence[str], Path], str]] = None,
) -> None:
    """D03 / DOGFOOD03b: re-assert the canonical worktree is in the
    same clean state it was in *before* the build started.

    ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01-CORRECTION01 (P1).
    Snapshots ``expected_status`` (the porcelain output captured before
    the build) and re-runs ``git status --porcelain=v1
    --untracked-files=all`` after the build. Any difference between the
    two outputs — including a previously-clean tree becoming dirty —
    raises :class:`BuildError`. This catches mutations to *any* path
    in the canonical tree, not just ``package.json``.
    """
    runner = run_cmd or _default_run
    current_status = runner(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], repo
    )
    if current_status != expected_status:
        raise BuildError(
            "canonical worktree mutated during build.\n"
            f"  before:\n{expected_status or '    (clean)'}\n"
            f"  after:\n{current_status or '    (clean)'}"
        )


# =============================================================================
# VSIX inspection (DOGFOOD05..07 — pure after a vsix on disk exists)
# =============================================================================


_VSIX_MANIFEST_NAME = "extension.vsixmanifest"
_VSIX_ENTRY_NAME = "extension/dist/extension.js"
_VSIX_WEBVIEW_PREFIX = "extension/webview-ui/build/assets/"
_VERSION_ATTR_RE = re.compile(r'<Identity\b[^>]*\bVersion="([^"]+)"', re.IGNORECASE)


def read_vsix_version(vsix_path: Path) -> str:
    """Read the ``Version`` attribute of ``<Identity>`` inside
    ``extension.vsixmanifest``. DOGFOOD05 baseline."""
    try:
        with zipfile.ZipFile(vsix_path) as z:
            text = z.read(_VSIX_MANIFEST_NAME).decode("utf-8", errors="replace")
    except (OSError, zipfile.BadZipFile, KeyError) as exc:
        raise BuildError(f"cannot read VSIX manifest from {vsix_path}: {exc}")
    m = _VERSION_ATTR_RE.search(text)
    if not m:
        raise BuildError("VSIX manifest has no <Identity Version=...>")
    return m.group(1)


def read_vsix_names(vsix_path: Path) -> set:
    """Return the set of all entry names inside a vsix. DOGFOOD07
    needs to discover whether the webview assets directory is
    non-empty without loading the archive's full content."""
    try:
        with zipfile.ZipFile(vsix_path) as z:
            return set(z.namelist())
    except (OSError, zipfile.BadZipFile) as exc:
        raise BuildError(f"cannot read VSIX entries from {vsix_path}: {exc}")


def verify_vsix_manifest(vsix_path: Path, expected_version: str) -> None:
    """Assert the embedded VSIX version equals ``expected_version``.
    DOGFOOD05 produces a mismatch by feeding a different
    ``expected_version`` and expects ``BuildError``."""
    actual = read_vsix_version(vsix_path)
    if actual != expected_version:
        raise BuildError(f"VSIX version mismatch: {actual} != {expected_version}")


def verify_vsix_payload(vsix_names: Iterable[str]) -> None:
    """Assert the VSIX payload is sane. DOGFOOD06 kills when
    ``_VSIX_ENTRY_NAME`` is missing; DOGFOOD07 kills when the
    ``_VSIX_WEBVIEW_PREFIX`` directory is absent (or has zero members)."""
    names = set(vsix_names)
    if _VSIX_ENTRY_NAME not in names:
        raise BuildError(f"{_VSIX_ENTRY_NAME} missing from VSIX")
    if not any(n.startswith(_VSIX_WEBVIEW_PREFIX) for n in names):
        raise BuildError(f"{_VSIX_WEBVIEW_PREFIX}* missing from VSIX")


# =============================================================================
# Install verification (DOGFOOD08)
# =============================================================================


def verify_install_listing(
    listing_output: str,
    expected_namespace_name: str,
    expected_version: str,
) -> None:
    """The dogfood CLI prints one ``publisher.name@version`` per
    line. After installing our VSIX, the listing must contain a line
    that exactly equals ``f"{ns_name}@{dogfood_version}"``.

    Pure: only string matching, no shell. DOGFOOD08.
    """
    expected = f"{expected_namespace_name}@{expected_version}"
    for line in listing_output.splitlines():
        if line.strip() == expected:
            return
    raise BuildError(f"installed extension not found: {expected}")


# =============================================================================
# IO helpers
# =============================================================================


def _default_run(argv: Sequence[str], cwd: Path, *, capture: bool = True) -> str:
    """Default subprocess runner. Echoes the command to stderr (so a
    running build has a readable trace), then either captures stdout
    or streams it; on non-zero exit, raises :class:`BuildError`."""
    print("+", " ".join(argv), file=sys.stderr)
    p = subprocess.run(
        list(argv),
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if p.returncode != 0:
        if capture:
            if p.stdout:
                print(p.stdout, file=sys.stderr, end="")
            if p.stderr:
                print(p.stderr, file=sys.stderr, end="")
        raise BuildError(f"command failed ({p.returncode}): {' '.join(argv)}")
    return (p.stdout or "").strip() if capture else ""


def require_executable(name: str) -> None:
    if shutil.which(name) is None:
        raise BuildError(f"required executable not found: {name}")


def repo_root(start: Path) -> Path:
    return Path(
        _default_run(["git", "rev-parse", "--show-toplevel"], start)
    ).resolve()


# =============================================================================
# Worktree lifecycle (D04, D12)
# =============================================================================


def create_detached_worktree(
    repo: Path,
    head: str,
    *,
    run_cmd: Optional[Callable[[Sequence[str], Path], str]] = None,
    run_visible: Optional[Callable[[Sequence[str], Path], None]] = None,
) -> "tempfile.TemporaryDirectory":
    """Allocate a tempdir and ``git worktree add --detach`` at
    ``head``. Returns the :class:`tempfile.TemporaryDirectory` so the
    caller can ``finally temp.cleanup()`` regardless of the worktree
    state. The staged worktree lives at ``tempdir/worktree``.

    ``run_cmd`` / ``run_visible`` are test seams (defaulting to the
    module's :func:`_default_run`); DOGFOOD01 uses them to assert
    that no subprocess is invoked when the canonical worktree is
    dirty.
    """
    capturing = run_cmd or (lambda argv, cwd: _default_run(argv, cwd, capture=True))
    streaming = run_visible or (
        lambda argv, cwd: _default_run(argv, cwd, capture=False)
    )

    temp = tempfile.TemporaryDirectory(prefix="clinemm-dogfood-")
    stage = Path(temp.name) / "worktree"
    try:
        streaming(
            ["git", "worktree", "add", "--detach", str(stage), head],
            repo,
        )
    except BuildError:
        temp.cleanup()
        raise
    staged_head = capturing(["git", "rev-parse", "HEAD"], stage)
    if staged_head != head:
        temp.cleanup()
        raise BuildError(
            f"temporary worktree HEAD mismatch: {staged_head} != {head}"
        )
    return temp


def remove_worktree_quietly(
    repo: Path,
    stage: Path,
    *,
    run_visible: Optional[Callable[[Sequence[str], Path], None]] = None,
) -> None:
    """Tear down a detached worktree. Tolerates the worktree already
    being gone, and falls back to ``shutil.rmtree`` if ``git worktree
    remove`` refuses (it does when bun / esbuild leaves tracked-file
    modifications behind). DOGFOOD09.

    ``run_visible`` is a test seam.
    """
    if not stage.exists():
        return
    streaming = run_visible or (
        lambda argv, cwd: _default_run(argv, cwd, capture=False)
    )
    try:
        streaming(
            ["git", "worktree", "remove", "--force", str(stage)],
            repo,
        )
    except BuildError as exc:
        print(
            f"WARNING: worktree cleanup via git failed ({exc}); "
            "falling back to rm -rf",
            file=sys.stderr,
        )
        try:
            shutil.rmtree(stage, ignore_errors=True)
        except OSError as rm_exc:
            print(f"WARNING: rmtree also failed: {rm_exc}", file=sys.stderr)


def finalize_worktree(
    repo: Path,
    stage: Path,
    temp: "tempfile.TemporaryDirectory",
    *,
    run_visible: Optional[Callable[[Sequence[str], Path], None]] = None,
) -> None:
    """``finally``-time teardown: remove the worktree (best-effort) then
    release the tempdir. DOGFOOD09 asserts both happen even on the
    exception path."""
    try:
        remove_worktree_quietly(repo, stage, run_visible=run_visible)
    finally:
        temp.cleanup()


# =============================================================================
# VSCE authority — pin the lockfile-determined binary (D05/D06)
# =============================================================================


def find_vsce_binary(stage_apps_vscode: Path) -> str:
    """Return the path to the VSCE binary the staged worktree has
    pinned via ``bun.lock``.

    The repo dependency graph declares ``@vscode/vsce`` as a dev
    dependency of ``apps/vscode``, so
    ``<stage>/apps/vscode/node_modules/.bin/vsce`` is the canonical
    lockfile-resolved binary. Resolving through that path means a
    fresh build cannot silently pick up a newer vsce release.

    Raises :class:`BuildError` if the pinned binary is absent — the
    build fails closed rather than network-fetching a substitute.
    """
    candidate = stage_apps_vscode / "node_modules" / ".bin" / "vsce"
    if not candidate.exists():
        raise BuildError(
            f"pinned vsce binary missing: {candidate} — "
            "is @vscode/vsce installed in the staged worktree?"
        )
    return str(candidate)


# =============================================================================
# Canonical build steps (D05/D06)
# =============================================================================


def run_canonical_build(stage: Path, *, run_visible: Optional[Callable[[Sequence[str], Path], None]] = None, skip_typecheck: bool = False) -> None:
    """Run the repo's canonical build pipeline:

        1. ``bun install --frozen-lockfile``          (D05, cwd=stage)
        2. ``bun run build:sdk``                       (cwd=stage)
        3a. ``bun run vscode:prepublish``              (D06, cwd=stage/apps/vscode)
            OR (if skip_typecheck=True -- DOGFOOD-VSIX-QUALIFICATION01
            deliberate dogfood shortcut, NOT for release):
        3b. ``bun run protos``                         (cwd=stage/apps/vscode)
            + ``bun run build:webview``                (cwd=stage/apps/vscode)
            + ``bun esbuild.mjs --production``         (cwd=stage/apps/vscode)

    ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01-CORRECTION02.

    CORRECTION02 (D06 cwd): ``vscode:prepublish`` is owned by the
    VS Code workspace package (``apps/vscode/package.json``). Bun
    resolves workspace scripts from the current package's
    ``package.json``; running it from the monorepo root produces
    "Script not found 'vscode:prepublish'". The fix is to invoke it
    with ``cwd=<stage>/apps/vscode``. Real builds now exercise the
    correct workspace each script belongs to.

    CORRECTION03 (D06 skip_typecheck): The full
    ``vscode:prepublish`` pipeline runs ``bun run check-types``
    (full-project ``tsc --noEmit``). The C2.5 + ELM-02F + E7 +
    E7-CORRECTION01 + E7-CORRECTION01-FIXUP01 ACT clusters
    intentionally left a known pre-existing baseline of tsc
    errors in test files (these are bounded baseline-isolated
    via the targeted ``check-types:c2-5-c4``,
    ``check-types:c2-4-c-bridge``, ``check-types:c2-4-d-hub``
    scripts and frozen via separate evidence documents; the
    full-project typecheck is NOT a gating baseline for the
    E7 qualification). For the DOGFOOD-VSIX-QUALIFICATION01
    ACT, the builder bypasses the typecheck gate and uses the
    ``esbuild`` + ``build:webview`` + ``protos`` path directly.
    esbuild does not typecheck (it transpiles only), so the
    VSIX is built from the same TypeScript sources without the
    gate. This is appropriate for dogfood (operational proof
    that the packaged artifact starts and uses the qualified
    Local machinery) and inappropriate for release; the
    production CI gate ``ci:check-all`` still enforces
    typecheck before any marketplace publication.

    The orchestrator calls this helper rather than duplicating the
    three commands inline; a previous design tried to be explicit but
    the inline copy drifted from the canonical command list, which is
    exactly how the wrong-cwd defect escaped the test suite.

    ``run_visible`` is a test seam; the default streams stdout/stderr.
    ``skip_typecheck`` is an explicit, audit-toggled shortcut.
    """
    runner = run_visible or (lambda argv, cwd: _default_run(argv, cwd, capture=False))
    runner(["bun", "install", "--frozen-lockfile"], stage)
    runner(["bun", "run", "build:sdk"], stage)
    if skip_typecheck:
        stage_vscode = stage / "apps" / "vscode"
        runner(["bun", "run", "protos"], stage_vscode)
        runner(["bun", "run", "build:webview"], stage_vscode)
        runner(["bun", "esbuild.mjs", "--production"], stage_vscode)
    else:
        runner(["bun", "run", "vscode:prepublish"], stage / "apps" / "vscode")


def vsce_package(
    stage_apps_vscode: Path,
    staged_vsix_out: Path,
    *,
    vsce_binary: Optional[str] = None,
    allow_secret: str = "sendgrid",
    run_visible: Optional[Callable[[Sequence[str], Path], None]] = None,
) -> None:
    """Run the pinned ``vsce package`` and write the VSIX at
    ``staged_vsix_out``. ``vsce_binary`` defaults to the lockfile-pinned
    binary via :func:`find_vsce_binary`."""
    binary = vsce_binary or find_vsce_binary(stage_apps_vscode)
    staged_vsix_out.parent.mkdir(parents=True, exist_ok=True)
    runner = run_visible or (lambda argv, cwd: _default_run(argv, cwd, capture=False))
    runner(
        [
            binary,
            "package",
            "--no-dependencies",
            "--allow-package-secrets",
            allow_secret,
            "--out",
            str(staged_vsix_out),
        ],
        stage_apps_vscode,
    )


# =============================================================================
# Artifact placement (D10)
# =============================================================================


def finalize_artifact(staged_vsix: Path, final_path: Path) -> None:
    """Atomically move the in-stage VSIX to ``final_path`` via a
    same-filesystem ``os.replace`` (a sibling ``.tmp`` is used for the
    cross-volume case). D10."""
    final_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_out = final_path.with_name(final_path.name + ".tmp")
    try:
        shutil.copy2(staged_vsix, tmp_out)
    except OSError as exc:
        try:
            os.unlink(tmp_out)
        except OSError:
            pass
        raise BuildError(f"cannot stage artifact {staged_vsix}: {exc}")
    try:
        os.replace(tmp_out, final_path)
    except OSError as exc:
        try:
            os.unlink(tmp_out)
        except OSError as unlink_exc:
            if unlink_exc.errno != errno.ENOENT:
                pass
        raise BuildError(f"cannot finalize artifact {final_path}: {exc}")


def compute_sha256(path: Path) -> str:
    """SHA-256 of a file's content. D10 — the artifact digest printed
    in the build's stdout JSON."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# =============================================================================
# Install step (D11)
# =============================================================================


def install_vsix(
    install_cli: str,
    vsix_path: Path,
    repo: Path,
    *,
    run_visible: Optional[Callable[[Sequence[str], Path], None]] = None,
) -> None:
    """Run ``<cli> --install-extension <vsix> --force``."""
    require_executable(install_cli)
    runner = run_visible or (lambda argv, cwd: _default_run(argv, cwd, capture=False))
    runner(
        [install_cli, "--install-extension", str(vsix_path), "--force"],
        repo,
    )


def list_installed_extensions(install_cli: str, repo: Path) -> str:
    """Return the captured output of
    ``<cli> --list-extensions --show-versions``."""
    return _default_run(
        [install_cli, "--list-extensions", "--show-versions"], repo, capture=True
    )


# =============================================================================
# Top-level orchestrator
# =============================================================================


def default_dogfood_vsix_name(name: str, dogfood_version: str) -> str:
    """Return ``<name>-<dogfood_version>.vsix`` (e.g.
    ``clinemm-4.1.10-2f3bdfeee.vsix``). Centralised so DOGFOOD10 and
    the orchestrator use the same filename convention."""
    safe_version = re.sub(r"[^A-Za-z0-9._-]", "-", dogfood_version)
    return f"{name}-{safe_version}.vsix"


def build_dogfood_vsix(
    *,
    repo: Path,
    output_dir: Path,
    install: bool = False,
    install_cli: str = "codium-cline",
    extension_ns_name: str = "s1onique.clinemm",
    force: bool = False,
    extension_short_name: str = "clinemm",
    skip_typecheck: bool = False,
    # Test seams:
    run_cmd: Optional[Callable[[Sequence[str], Path], str]] = None,
    run_visible: Optional[Callable[[Sequence[str], Path], None]] = None,
) -> dict:
    """Compose D01..D12. Returns the result dict (also printed by the
    CLI). Raises :class:`BuildError` on any invariant violation.

    ``run_cmd`` / ``run_visible`` are test seams:
      - ``run_cmd(argv, cwd) -> str`` is the capturing runner.
      - ``run_visible(argv, cwd)`` is the streaming runner.

    On invocation, the orchestrator:
      1. D02 — checks the canonical worktree is clean (DOGFOOD01).
      2. D01 — captures exact HEAD and the 9-char short SHA.
      3. D07 — derives the dogfood version ``X.Y.Z-<shortsha>``.
      4. D10 — refuses to overwrite an existing artifact unless
         ``force=True`` (DOGFOOD10).
      5. D03 — snapshots the canonical clean-tree state and the
         source ``package.json`` byte content (DOGFOOD03, DOGFOOD03b).
      6. D04 — spins up a detached worktree at exact HEAD.
      7. D05 — ``bun install --frozen-lockfile``.
      8. D06 — ``bun run build:sdk`` then ``bun run vscode:prepublish``
         (or, with ``skip_typecheck=True``, the lower-level
         ``protos``+``build:webview``+``esbuild --production`` path
         that bypasses the typecheck gate; see CORRECTION03).
      9. D03 — re-asserts source ``package.json`` byte-equality
         AND canonical-tree porcelain equality (DOGFOOD03b).
     10. D07 (stage patch) — stamps the staged ``package.json``.
         Fails closed if the staged manifest is missing
         (DOGFOOD04b).
     11. D05 (VSCE authority) — runs the pinned ``vsce package``.
     12. D08 — verifies the embedded manifest version (DOGFOOD05).
     13. D09 — verifies payload sanity (DOGFOOD06, DOGFOOD07).
     14. D10 — finalizes the artifact and computes its SHA-256.
     15. D11 (optional) — installs and verifies the listing (DOGFOOD08).
     16. D12 — tears down the worktree and tempdir (DOGFOOD09).
    """
    if run_cmd is None:
        run_cmd = _default_run
    if run_visible is None:
        run_visible = lambda argv, cwd: _default_run(argv, cwd, capture=False)

    # ---- D02 CLEAN_SOURCE_ONLY (DOGFOOD01) ------------------------------
    status_output = run_cmd(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"], repo
    )
    assert_clean_worktree(repo, status_output=status_output)

    # ---- D01 EXACT_SOURCE_BINDING ---------------------------------------
    head = full_sha_from_head(repo, run_cmd=run_cmd)
    short = short_sha_from_head(repo, run_cmd=run_cmd)
    source_pkg = repo / "apps" / "vscode" / "package.json"
    source_version = read_package_version(source_pkg)

    # ---- D07 PACKAGE_VERSION ---------------------------------------------
    dogfood_version = derive_dogfood_version(source_version, short)

    # ---- D10 ARTIFACT_IDENTITY -------------------------------------------
    output_dir.mkdir(parents=True, exist_ok=True)
    final_path = output_dir / default_dogfood_vsix_name(extension_short_name, dogfood_version)
    if final_path.exists() and not force:
        raise BuildError(f"refusing to overwrite {final_path}; use --force")
    # DOGFOOD10 — same error message the CLI surfaces.

    # ---- D03 SOURCE_IMMUTABILITY snapshots -------------------------------
    # CORRECTION01 (P1): capture both the canonical porcelain state
    # AND the source manifest byte-content so post-build we can assert
    # "before == after" on the canonical worktree (DOGFOOD03b).
    pinned_source_pkg_bytes = source_pkg.read_bytes()
    pinned_canonical_status = status_output

    # ---- D04 ISOLATED_BUILD (DOGFOOD09 via finally below) --------------
    temp = create_detached_worktree(
        repo, head, run_cmd=run_cmd, run_visible=run_visible
    )
    stage = Path(temp.name) / "worktree"
    stage_apps = stage / "apps" / "vscode"

    try:
        # ---- D05 / D06 CANONICAL_BUILD ----------------------------------
        # CORRECTION02: delegate to ``run_canonical_build`` rather than
        # duplicate the three commands inline. The wrong-cwd defect for
        # ``vscode:prepublish`` escaped precisely because the inline
        # copy in this function diverged from the helper's source of
        # truth. Pinning once, here, also pins the test surface (the
        # helper is the unit-tested boundary).
        run_canonical_build(
            stage, run_visible=run_visible, skip_typecheck=skip_typecheck
        )

        # ---- D03 SOURCE_IMMUTABILITY post-build assertions --------------
        # CORRECTION01 (P1): two complementary checks.
        current_source_bytes = source_pkg.read_bytes()
        if current_source_bytes != pinned_source_pkg_bytes:
            raise BuildError(
                "source package.json mutated during build "
                f"(bytes {len(current_source_bytes)} != "
                f"{len(pinned_source_pkg_bytes)})"
            )
        assert_clean_worktree_equal(
            repo,
            expected_status=pinned_canonical_status,
            run_cmd=run_cmd,
        )

        # ---- D07 stage-specific patch (DOGFOOD04, DOGFOOD04b) ------------
        write_package_version(stage_apps / "package.json", dogfood_version)

        # ---- D05 (cont.) VSCE_AUTHORITY ---------------------------------
        stage_out = stage_apps / "dist" / final_path.name
        vsce_package(stage_apps, stage_out, run_visible=run_visible)

        # ---- D08 PACKAGE_VERIFICATION (DOGFOOD05) -----------------------
        verify_vsix_manifest(stage_out, dogfood_version)

        # ---- D09 PAYLOAD_SANITY (DOGFOOD06, DOGFOOD07) ------------------
        verify_vsix_payload(read_vsix_names(stage_out))

        # ---- D10 ARTIFACT_IDENTITY --------------------------------------
        finalize_artifact(stage_out, final_path)
        result = {
            "source_head": head,
            "source_version": source_version,
            "dogfood_version": dogfood_version,
            "artifact": str(final_path),
            "sha256": compute_sha256(final_path),
            "bytes": final_path.stat().st_size,
            "skip_typecheck": skip_typecheck,
        }

        # ---- D11 OPTIONAL_INSTALL (DOGFOOD08) ---------------------------
        if install:
            install_vsix(install_cli, final_path, repo, run_visible=run_visible)
            listing = list_installed_extensions(install_cli, repo)
            verify_install_listing(
                listing, extension_ns_name, dogfood_version
            )
            result["installed"] = f"{extension_ns_name}@{dogfood_version}"

        return result
    finally:
        # ---- D12 CLEANUP (DOGFOOD09) ------------------------------------
        # Single finally; ``create_detached_worktree()`` already cleans
        # its own tempdir on creation failure, so no separate outer
        # ``except`` block is needed to catch that case.
        finalize_worktree(repo, stage, temp, run_visible=run_visible)


__all__ = [
    "BuildError",
    "derive_dogfood_version",
    "read_package_version",
    "write_package_version",
    "short_sha_from_head",
    "full_sha_from_head",
    "assert_clean_worktree",
    "assert_clean_worktree_equal",
    "read_vsix_version",
    "read_vsix_names",
    "verify_vsix_manifest",
    "verify_vsix_payload",
    "verify_install_listing",
    "create_detached_worktree",
    "remove_worktree_quietly",
    "finalize_worktree",
    "find_vsce_binary",
    "run_canonical_build",
    "vsce_package",
    "finalize_artifact",
    "compute_sha256",
    "install_vsix",
    "list_installed_extensions",
    "default_dogfood_vsix_name",
    "build_dogfood_vsix",
]
