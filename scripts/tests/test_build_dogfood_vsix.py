#!/usr/bin/env python3
"""ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01 invariant tests (DOGFOOD01..10).

Run:
    python3 scripts/tests/test_build_dogfood_vsix.py
or via the standard unittest discovery from the repo root:
    python3 -m unittest scripts.tests.test_build_dogfood_vsix -v

These tests deliberately do NOT touch Bun, VSCE, or VS Code. They
pin the orchestration logic in
``scripts/build_dogfood_vsix_lib.py`` by:

    1. Driving pure helpers with hand-crafted inputs (DOGFOOD02,
       DOGFOOD03, DOGFOOD04, DOGFOOD04b, DOGFOOD05..DOGFOOD08,
       DOGFOOD10).
    2. Faking the subprocess runner for
       :func:`build_dogfood_vsix_lib.build_dogfood_vsix` (DOGFOOD01,
       DOGFOOD03b, DOGFOOD05b, DOGFOOD05c, DOGFOOD09 cleanup).
    3. Using :mod:`tempfile` / :mod:`zipfile` to materialise minimal
       vsix fixtures for the verification helpers (DOGFOOD05..08).

Mapping to ACT invariants D01..D12:
    D01 EXACT_SOURCE_BINDING        DOGFOOD02 (derive_dogfood_version)
    D02 CLEAN_SOURCE_ONLY           DOGFOOD01 (assert_clean_worktree)
    D03 SOURCE_IMMUTABILITY         DOGFOOD03 (helper byte equality)
                                    DOGFOOD03b (orchestrator post-build
                                                tree-status re-check)
    D04 ISOLATED_BUILD              implicit — exercised in DOGFOOD09,
                                    DOGFOOD10 via the orchestrator's
                                    create_detached_worktree teardown
    D05 LOCKFILE_AUTHORITY          DOGFOOD05b (command/cwd trace:
                                    ``bun install --frozen-lockfile``
                                    invoked with ``cwd=stage``)
                                    DOGFOOD05c (orchestrator delegates
                                    to ``run_canonical_build``)
    D06 CANONICAL_BUILD             DOGFOOD05b (command/cwd trace:
                                    ``bun run vscode:prepublish``
                                    invoked with
                                    ``cwd=stage/apps/vscode``, NOT
                                    the monorepo root)
                                    DOGFOOD05c (orchestrator delegates
                                    to ``run_canonical_build``)
    D07 PACKAGE_VERSION             DOGFOOD04 (write_package_version)
                                    DOGFOOD04b (fail-closed on missing
                                                staged manifest)
    D08 PACKAGE_VERIFICATION        DOGFOOD05 (verify_vsix_manifest)
    D09 PAYLOAD_SANITY              DOGFOOD06 (extension.js present),
                                    DOGFOOD07 (webview assets present)
    D10 ARTIFACT_IDENTITY           DOGFOOD10 (refuses to overwrite)
    D11 OPTIONAL_INSTALL            DOGFOOD08 (verify_install_listing)
    D12 CLEANUP                     DOGFOOD09 (cleanup on exception)

What this suite does NOT prove (separate evidence required):
    BIT_REPRODUCIBLE_VSIX         building HEAD twice in two fresh
                                    isolated worktrees and comparing
                                    the SHA-256s is a separate test
                                    that we have NOT run; D01..D12
                                    establish REPRODUCIBLE_PROVENANCE
                                    (deterministic inputs, identity,
                                    dependency authority, vsce
                                    authority, verification) — not
                                    byte-for-byte reproducibility.
    FIRST_REAL_BUILD               the D05/D06 command trace is
                                    pinned directly (DOGFOOD05b,
                                    DOGFOOD05c), but the FIRST end-to-
                                    end run against the real
                                    repository at HEAD is itself the
                                    verification step; this commit
                                    fixes a defect the first such
                                    run surfaced.
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from typing import Optional

# Make the library importable regardless of how this test file is
# invoked (direct, ``python3 -m unittest``, or via the repo's
# top-level test runner).
_HERE = Path(__file__).resolve().parent
_LIB_DIR = _HERE.parent  # …/scripts/
sys.path.insert(0, str(_LIB_DIR))

from build_dogfood_vsix_lib import (  # noqa: E402
    BuildError,
    assert_clean_worktree,
    assert_clean_worktree_equal,
    build_dogfood_vsix,
    build_elm_kernel,
    compute_sha256,
    default_dogfood_vsix_name,
    derive_dogfood_version,
    disable_vscode_prepublish_hook,
    read_package_version,
    remove_worktree_quietly,
    run_canonical_build,
    stage_elm_kernel_runtime_asset,
    verify_install_listing,
    verify_vsix_manifest,
    verify_vsix_payload,
    write_package_version,
)


# =============================================================================
# Fixtures: zipfile-based minimal vsix generator
# =============================================================================


def _make_vsix(path: Path, *, version: str, include_ext: bool = True, include_webview: bool = True) -> None:
    """Materialise a minimal but well-formed vsix with the requested
    ``<Identity Version="...">`` in ``extension.vsixmanifest`` and the
    payload entries :func:`verify_vsix_payload` looks for.

    Tests pass ``include_ext=False`` / ``include_webview=False`` to
    simulate a missing payload entry.
    """
    manifest = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<PackageManifest Version="2.0.0">\n'
        '  <Metadata>\n'
        f'    <Identity Id="s1onique.clinemm" Version="{version}" Publisher="s1onique"/>\n'
        '  </Metadata>\n'
        '</PackageManifest>\n'
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("extension.vsixmanifest", manifest)
        if include_ext:
            z.writestr("extension/dist/extension.js", "// stub\n")
        if include_webview:
            z.writestr(
                "extension/webview-ui/build/assets/index.js",
                "// webview stub\n",
            )


def _write_package_json(directory: Path, *, version: str) -> Path:
    """Write a minimal ``package.json`` at ``<directory>/package.json``.

    Creates intermediate parents as needed. Used to materialise both
    source-style and stage-style manifests in unit tests.
    """
    path = directory / "package.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "name": "clinemm",
                "version": version,
                "publisher": "s1onique",
            },
            indent=2,
        )
        + "\n"
    )
    return path


def _seed_staged_prepublish_hook(apps_dir: Path) -> Path:
    """Add a realistic ``scripts.vscode:prepublish`` block to an
    already-written staged manifest. In real builds the staged
    manifest is a copy of the canonical ``apps/vscode/package.json``
    which already declares the hook; the CORRECTION06 disable helper
    only mutates the hook if it is present, so tests that drive the
    full orchestrator must seed it explicitly.
    """
    path = apps_dir / "package.json"
    data = json.loads(path.read_text())
    scripts = data.setdefault("scripts", {})
    scripts["vscode:prepublish"] = "bun run check-types"
    path.write_text(json.dumps(data, indent=2) + "\n")
    return path


# =============================================================================
# DOGFOOD01 — dirty worktree is rejected before any build step runs
# =============================================================================


class TestDogfood01CleanSourceOnly(unittest.TestCase):
    """D02 / DOGFOOD01: a non-empty ``git status --porcelain`` must
    raise :class:`BuildError` and no subprocess may be invoked beyond
    the status probe itself."""

    def test_empty_status_is_clean(self) -> None:
        # Should not raise.
        assert_clean_worktree(Path("/does-not-matter"), status_output="")

    def test_whitespace_only_is_clean(self) -> None:
        # Defensive: ``git status`` may return a trailing newline.
        assert_clean_worktree(Path("/does-not-matter"), status_output="\n  \n")

    def test_tracked_modification_fails_closed(self) -> None:
        with self.assertRaises(BuildError) as ctx:
            assert_clean_worktree(
                Path("/does-not-matter"),
                status_output=" M apps/vscode/src/sdk/SdkController.ts\n",
            )
        self.assertIn("dirty", str(ctx.exception))

    def test_untracked_file_fails_closed(self) -> None:
        with self.assertRaises(BuildError) as ctx:
            assert_clean_worktree(
                Path("/does-not-matter"),
                status_output="?? scripts/build-dogfood-vsix.py\n",
            )
        self.assertIn("dirty", str(ctx.exception))

    def test_build_dogfood_vsix_short_circuits_on_dirty_tree(self) -> None:
        """When ``run_cmd`` for ``git status`` returns dirty content,
        the orchestrator must not call any other subprocess (no git
        rev-parse, no bun install, no vsce package)."""
        calls: list[list[str]] = []

        def fake_run(argv, cwd, **_kwargs):
            calls.append(list(argv))
            if argv[:2] == ["git", "status"]:
                return " M src/something.ts\n"
            if argv[:2] == ["git", "rev-parse"] and any(a.startswith("--short") for a in argv):
                return "abc123456"
            if argv[:2] == ["git", "rev-parse"] and argv[-1] == "HEAD":
                return "abcdef1234567890abcdef1234567890abcdef12"
            return ""

        fake_visible_calls: list[list[str]] = []

        def fake_visible(argv, cwd):
            fake_visible_calls.append(list(argv))

        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / "repo"
            repo.mkdir()
            _write_package_json(repo / "apps" / "vscode", version="4.1.10")
            with self.assertRaises(BuildError) as ctx:
                build_dogfood_vsix(
                    repo=repo,
                    output_dir=Path(tmp) / "out",
                    run_cmd=fake_run,
                    run_visible=fake_visible,
                )
        self.assertIn("dirty", str(ctx.exception))
        self.assertEqual(
            fake_visible_calls,
            [],
            msg="build steps must not run when the tree is dirty",
        )
        non_status_calls = [
            c for c in calls if not (c[:2] == ["git", "status"])
        ]
        self.assertEqual(
            non_status_calls,
            [],
            msg=f"unexpected subprocesses after dirty gate: {non_status_calls}",
        )


# =============================================================================
# DOGFOOD02 — derive_dogfood_version is pure + correct
# =============================================================================


class TestDogfood02VersionDerivation(unittest.TestCase):
    """D01 / D07 / DOGFOOD02: the 9-char short SHA is appended to the
    source version with a hyphen separator."""

    def test_short_sha_appended_with_hyphen(self) -> None:
        self.assertEqual(
            derive_dogfood_version("4.1.10", "2f3bdfeee"),
            "4.1.10-2f3bdfeee",
        )

    def test_three_part_source_version_works(self) -> None:
        self.assertEqual(
            derive_dogfood_version("0.0.1", "deadbeef0"),
            "0.0.1-deadbeef0",
        )

    def test_pre_release_source_version_works(self) -> None:
        self.assertEqual(
            derive_dogfood_version("4.1.10-rc.1", "abc123456"),
            "4.1.10-rc.1-abc123456",
        )

    def test_full_seven_char_sha_works(self) -> None:
        self.assertEqual(
            derive_dogfood_version("4.1.10", "abcdef1"),
            "4.1.10-abcdef1",
        )

    def test_empty_source_version_fails(self) -> None:
        with self.assertRaises(BuildError):
            derive_dogfood_version("", "2f3bdfeee")

    def test_empty_short_sha_fails(self) -> None:
        with self.assertRaises(BuildError):
            derive_dogfood_version("4.1.10", "")

    def test_default_vsix_name_uses_dogfood_version(self) -> None:
        self.assertEqual(
            default_dogfood_vsix_name("clinemm", "4.1.10-2f3bdfeee"),
            "clinemm-4.1.10-2f3bdfeee.vsix",
        )


# =============================================================================
# DOGFOOD03 — source package.json is byte-for-byte unchanged by the
# orchestrator (when no mutation injection is in play)
# =============================================================================


class TestDogfood03SourceImmutability(unittest.TestCase):
    """D03 / DOGFOOD03: writing to a *staged* package.json must not
    touch the source repository's package.json. The orchestrator
    re-asserts the source version string after the build, so even a
    rare mutation would fail closed with BuildError."""

    def test_write_package_version_only_mutates_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            source_pkg = _write_package_json(
                tmp / "src_apps_vscode", version="4.1.10"
            )
            staged_pkg = _write_package_json(
                tmp / "stage_apps_vscode", version="4.1.10"
            )
            source_bytes_before = source_pkg.read_bytes()

            write_package_version(staged_pkg, "4.1.10-2f3bdfeee")

            self.assertEqual(source_pkg.read_bytes(), source_bytes_before)
            self.assertEqual(read_package_version(source_pkg), "4.1.10")
            self.assertEqual(
                read_package_version(staged_pkg), "4.1.10-2f3bdfeee"
            )

    def test_write_package_version_preserves_other_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            staged_pkg = tmp / "pkg.json"
            staged_pkg.write_text(
                json.dumps(
                    {
                        "name": "clinemm",
                        "version": "4.1.10",
                        "publisher": "s1onique",
                        "displayName": "ClineMM",
                    },
                    indent=2,
                )
                + "\n"
            )
            write_package_version(staged_pkg, "4.1.10-2f3bdfeee")
            data = json.loads(staged_pkg.read_text())
            self.assertEqual(data["version"], "4.1.10-2f3bdfeee")
            self.assertEqual(data["name"], "clinemm")
            self.assertEqual(data["publisher"], "s1onique")
            self.assertEqual(data["displayName"], "ClineMM")


# =============================================================================
# DOGFOOD04 — staging actually patches the staged manifest
# =============================================================================


class TestDogfood04StageManifestPatched(unittest.TestCase):
    """D07 / DOGFOOD04: ``write_package_version`` round-trips through
    JSON and emits the requested value with a trailing newline."""

    def test_write_then_read_round_trips(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _write_package_json(Path(tmp), version="4.1.10")
            write_package_version(pkg, "4.1.10-2f3bdfeee")
            self.assertEqual(read_package_version(pkg), "4.1.10-2f3bdfeee")

    def test_write_idempotent(self) -> None:
        """Calling ``write_package_version`` twice with the same target
        is idempotent (used by retries / re-assertions)."""
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _write_package_json(Path(tmp), version="4.1.10")
            write_package_version(pkg, "4.1.10-2f3bdfeee")
            write_package_version(pkg, "4.1.10-2f3bdfeee")
            self.assertEqual(read_package_version(pkg), "4.1.10-2f3bdfeee")
            self.assertTrue(pkg.read_text().endswith("\n"))


# =============================================================================
# DOGFOOD04b — fail-closed on missing staged manifest (CORRECTION01 P0)
# =============================================================================


class TestDogfood04bMissingStageManifestFailsClosed(unittest.TestCase):
    """DOGFOOD04b: ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01-CORRECTION01 (P0).

    ``write_package_version`` MUST refuse to fabricate a manifest when
    the staged ``apps/vscode/package.json`` is missing. A missing
    manifest in a real detached worktree is a hard error condition
    (wrong worktree, wrong repo layout, failed checkout, bad path,
    corrupted subject) — the build must stop at the first broken
    authority rather than silently manufacture a stub and push on.
    Tests must create realistic staged fixtures; this is NOT a
    convenience for synthesising empty worktrees.
    """

    def test_missing_file_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            missing = Path(tmp) / "worktree" / "apps" / "vscode" / "package.json"
            # Note: deliberately NOT creating the file or its parents.
            with self.assertRaises(BuildError) as ctx:
                write_package_version(missing, "4.1.10-2f3bdfeee")
        self.assertIn("staged package.json missing", str(ctx.exception))
        self.assertIn("refusing to fabricate", str(ctx.exception))

    def test_existing_directory_not_a_file_fails_closed(self) -> None:
        """A directory at the manifest path is not a file. ``is_file()``
        returns False; the fail-closed check must fire."""
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "package.json"
            manifest_path.mkdir()  # a directory at the path, not a file
            with self.assertRaises(BuildError) as ctx:
                write_package_version(manifest_path, "4.1.10-2f3bdfeee")
        self.assertIn("staged package.json missing", str(ctx.exception))

    def test_present_file_still_writes(self) -> None:
        """Sanity: the fail-closed branch doesn't break the happy path."""
        with tempfile.TemporaryDirectory() as tmp:
            pkg = _write_package_json(Path(tmp), version="4.1.10")
            write_package_version(pkg, "4.1.10-2f3bdfeee")
            self.assertEqual(read_package_version(pkg), "4.1.10-2f3bdfeee")


# =============================================================================
# DOGFOOD03b — canonical tree-clean equality (CORRECTION01 P1)
# =============================================================================


class TestDogfood03bCanonicalTreeCleanAfterBuild(unittest.TestCase):
    """DOGFOOD03b: ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01-CORRECTION01 (P1).

    After the build, the orchestrator re-runs
    ``git status --porcelain=v1 --untracked-files=all`` against the
    canonical worktree and compares it to the snapshot taken before
    the build. Any difference — including a previously-clean tree
    becoming dirty — raises :class:`BuildError`. This catches
    mutations to *any* path in the canonical tree, not just
    ``package.json``.
    """

    def test_matching_status_passes(self) -> None:
        # Should not raise.
        assert_clean_worktree_equal(
            Path("/does-not-matter"),
            expected_status="",
            run_cmd=lambda argv, cwd: "",
        )

    def test_drift_after_build_fails_closed(self) -> None:
        """A previously-clean tree that becomes dirty after the build
        must fail closed."""
        with self.assertRaises(BuildError) as ctx:
            assert_clean_worktree_equal(
                Path("/does-not-matter"),
                expected_status="",
                run_cmd=lambda argv, cwd: "?? some/file.ts\n",
            )
        self.assertIn("canonical worktree mutated", str(ctx.exception))
        self.assertIn("before", str(ctx.exception))
        self.assertIn("after", str(ctx.exception))

    def test_drift_before_clean_after_passes(self) -> None:
        """A previously-dirty tree that becomes clean after the build
        is also drift — and must also fail closed. (The orchestrator
        pairs this with DOGFOOD01, which already requires the tree to
        start clean, so this case is a defensive check.)"""
        with self.assertRaises(BuildError):
            assert_clean_worktree_equal(
                Path("/does-not-matter"),
                expected_status="?? pre-existing-untracked.ts\n",
                run_cmd=lambda argv, cwd: "",
            )


# =============================================================================
# DOGFOOD05b — canonical build command/cwd trace (CORRECTION02 D05/D06)
# =============================================================================


class TestDogfood05bCanonicalBuildCommandCwdTrace(unittest.TestCase):
    """DOGFOOD05b: ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01-CORRECTION02.

    Pin the exact (argv, cwd) pairs of the canonical build pipeline:

        ["bun", "install", "--frozen-lockfile"]   cwd = stage
        ["bun", "run", "build:sdk"]               cwd = stage
        ["bun", "run", "vscode:prepublish"]        cwd = stage/apps/vscode

    The third pair is the bug the first real build caught.
    M_D06_WRONG_CWD: change ``stage/apps/vscode`` -> ``stage`` ->
    DOGFOOD05b fails.
    """

    def test_canonical_build_helper_runs_with_correct_cwds(self) -> None:
        trace: list[tuple[list[str], Path]] = []

        def record(argv, cwd):
            trace.append((list(argv), Path(cwd)))

        with tempfile.TemporaryDirectory() as tmp:
            stage = Path(tmp)
            run_canonical_build(stage, run_visible=record)

        self.assertEqual(len(trace), 3)
        self.assertEqual(
            trace[0], (["bun", "install", "--frozen-lockfile"], Path(stage))
        )
        self.assertEqual(trace[1], (["bun", "run", "build:sdk"], Path(stage)))
        self.assertEqual(
            trace[2],
            (
                ["bun", "run", "vscode:prepublish"],
                Path(stage) / "apps" / "vscode",
            ),
        )


# =============================================================================
# DOGFOOD05 — verify_vsix_manifest rejects mismatched versions
# =============================================================================


class TestDogfood05ManifestVerification(unittest.TestCase):
    """D08 / DOGFOOD05: the embedded ``<Identity Version="...">`` must
    equal the expected dogfood version."""

    def test_matching_version_passes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vsix = Path(tmp) / "stub.vsix"
            _make_vsix(vsix, version="4.1.10-2f3bdfeee")
            # Should not raise.
            verify_vsix_manifest(vsix, "4.1.10-2f3bdfeee")

    def test_mismatched_version_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vsix = Path(tmp) / "stub.vsix"
            _make_vsix(vsix, version="4.1.10")
            with self.assertRaises(BuildError) as ctx:
                verify_vsix_manifest(vsix, "4.1.10-2f3bdfeee")
        self.assertIn("mismatch", str(ctx.exception))

    def test_missing_manifest_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vsix = Path(tmp) / "stub.vsix"
            with zipfile.ZipFile(vsix, "w") as z:
                z.writestr("extension/dist/extension.js", "//\n")
            with self.assertRaises(BuildError):
                verify_vsix_manifest(vsix, "4.1.10-2f3bdfeee")


# =============================================================================
# DOGFOOD05c — orchestrator delegates to run_canonical_build (CORRECTION02)
# =============================================================================


class TestDogfood05cOrchestratorUsesCanonicalBuildHelper(unittest.TestCase):
    """DOGFOOD05c: ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01-CORRECTION02.

    The orchestrator MUST delegate to ``run_canonical_build``
    rather than repeat the three commands inline. A failed real
    build reproduced "Script not found 'vscode:prepublish'" because
    the inline copy had the wrong cwd; the helper carries the
    correct cwd. Pinning the orchestrator's invocation here
    guarantees it cannot regress to the duplicate-and-drift
    pattern.
    """

    def test_orchestrator_invokes_vscode_prepublish_with_apps_vscode_cwd(
        self,
    ) -> None:
        # The fake runners observe (argv, cwd) and short-circuit
        # every other step so the orchestrator can advance past the
        # canonical build without raising.
        visible_trace: list[tuple[list[str], Path]] = []

        def fake_cmd(argv, cwd, **_kw):
            if argv[:2] == ["git", "status"]:
                return ""
            if argv[:2] == ["git", "rev-parse"] and any(
                a.startswith("--short") for a in argv
            ):
                return "2f3bdfeee"
            if argv[:2] == ["git", "rev-parse"] and argv[-1] == "HEAD":
                return "abcdef1234567890abcdef1234567890abcdef12"
            if argv[:2] == ["git", "rev-parse"]:
                return "abcdef1234567890abcdef1234567890abcdef12"
            if argv[:3] == ["git", "worktree", "add"]:
                # Set up a detached worktree with the staged
                # manifest in place so D07 (write_package_version)
                # finds it.
                wstage = Path(argv[4])
                wstage.mkdir(parents=True, exist_ok=True)
                apps = wstage / "apps" / "vscode"
                apps.mkdir(parents=True, exist_ok=True)
                _write_package_json(apps, version="4.1.10")
                (apps / "dist").mkdir(parents=True, exist_ok=True)
                dogfood_version = derive_dogfood_version("4.1.10", "2f3bdfeee")
                staged_vsix = apps / "dist" / default_dogfood_vsix_name(
                    "clinemm", dogfood_version
                )
                _make_vsix(staged_vsix, version=dogfood_version)
                return ""
            if argv[:3] == ["git", "worktree", "remove"]:
                shutil.rmtree(argv[4], ignore_errors=True)
                return ""
            return ""

        def fake_visible(argv, cwd):
            visible_trace.append((list(argv), Path(cwd)))
            if argv[:3] == ["git", "worktree", "add"]:
                wstage = Path(argv[4])
                wstage.mkdir(parents=True, exist_ok=True)
                apps = wstage / "apps" / "vscode"
                apps.mkdir(parents=True, exist_ok=True)
                _write_package_json(apps, version="4.1.10")
                (apps / "dist").mkdir(parents=True, exist_ok=True)
                return

        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            repo = tmp / "repo"
            repo.mkdir()
            _write_package_json(repo / "apps" / "vscode", version="4.1.10")
            out = tmp / "out"
            out.mkdir()

            try:
                build_dogfood_vsix(
                    repo=repo,
                    output_dir=out,
                    run_cmd=fake_cmd,
                    run_visible=fake_visible,
                )
            except BuildError:
                # BuildError at later steps is fine for this trace
                # assertion; we only care about the canonical build
                # call history.
                pass

        prepublish = [
            (argv, cwd)
            for argv, cwd in visible_trace
            if argv[:3] == ["bun", "run", "vscode:prepublish"]
        ]
        self.assertEqual(
            len(prepublish),
            1,
            msg=(
                "expected exactly one vscode:prepublish invocation, "
                f"got {prepublish!r}"
            ),
        )
        argv, cwd = prepublish[0]
        self.assertEqual(argv, ["bun", "run", "vscode:prepublish"])
        self.assertTrue(
            str(cwd).endswith("worktree/apps/vscode"),
            msg=(
                "vscode:prepublish cwd must be stage/apps/vscode "
                f"(got {cwd})"
            ),
        )

    def test_orchestrator_does_not_re_implement_canonical_build_inline(self) -> None:
        """Structural sentinel (source-grep): the orchestrator body
        must NOT contain the literal three-command sequence it used
        to duplicate. Allowed expressions: only the helper call.

        M_DUPL: re-introduce the three
        ``run_visible(["bun", ...], stage)`` calls inline -> fails.
        """
        import re as _re

        source = (
            Path(__file__).resolve().parent.parent
            / "build_dogfood_vsix_lib.py"
        ).read_text(encoding="utf-8")

        marker_re = _re.compile(
            r"^def build_dogfood_vsix\(", _re.MULTILINE
        )
        start = marker_re.search(source)
        if start is None:
            self.fail("could not locate build_dogfood_vsix")
        # Take 6 KB of source from the def -- past the function end.
        body = source[start.start(): start.start() + 6_000]

        banned = (
            'run_visible(["bun", "install", "--frozen-lockfile"], stage)',
            'run_visible(["bun", "run", "build:sdk"], stage)',
            'run_visible(["bun", "run", "vscode:prepublish"], stage)',
        )
        for literal in banned:
            self.assertNotIn(
                literal,
                body,
                msg=(
                    "build_dogfood_vsix must call run_canonical_build(stage) "
                    "rather than re-implement the canonical build inline. "
                    f"Found banned literal: {literal!r}"
                ),
            )

        # Reverse positive check: the helper IS invoked. Allow either
        # with or without the skip_typecheck kwarg (CORRECTION03
        # added the optional dogfood shortcut).
        self.assertTrue(
            ("run_canonical_build(stage, run_visible=run_visible)" in body)
            or ("run_canonical_build(\n            stage, run_visible=run_visible, skip_typecheck=skip_typecheck\n        )" in body)
            or ("run_canonical_build(stage, run_visible=run_visible, skip_typecheck=skip_typecheck)" in body),
            msg=(
                "build_dogfood_vsix must call run_canonical_build(stage, "
                "run_visible=run_visible) [with or without skip_typecheck]."
            ),
        )


# =============================================================================
# DOGFOOD-CORRECTION06 — disable_vscode_prepublish_hook is unconditional.
#
# ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01-CORRECTION06
# (DUPLICATE-PREPUBLISH-SUPPRESSION).
#
# ``vsce package`` automatically invokes ``scripts.vscode:prepublish`` (NPM
# lifecycle integration). The dogfood orchestrator already runs the canonical
# prepublish exactly once via ``run_canonical_build``. A second invocation --
# against a working tree that has since been mutated by Elm build + runtime-
# asset stage -- surfaces Biome lint errors against compiler-generated
# runtime-assets/*.js and aborts packaging.
#
# CORRECTION06 widens the hook-neutering from "skip_typecheck only" (which
# CORRECTION04 introduced) to UNCONDITIONAL. The fix targets the structural
# defect (one build gate per package) rather than the typecheck shortcut.
#
# Invariants pinned by this section:
#
#   C06-I1  ``disable_vscode_prepublish_hook`` neuters ``scripts.vscode:
#           prepublish`` to a no-op on the staged manifest.
#   C06-I2  The orchestrator invokes the neutering unconditionally --
#           both with skip_typecheck=True AND skip_typecheck=False.
#   C06-I3  The canonical (source) package.json is NEVER mutated.
#   C06-I4  Ordering: neutering occurs AFTER the canonical build
#           (run_canonical_build) and BEFORE ``vsce package`` /
#           Elm build / Elm stage.
# =============================================================================


class TestCorrection06DisablePrepublishHookHelper(unittest.TestCase):
    """C06-I1: unit-level coverage of the helper itself.

    CORRECTION06 widened the call site but did not change the helper's
    contract. These tests pin the helper's behaviour so a future
    refactor cannot silently weaken it.
    """

    def test_neuters_vscode_prepublish_hook_to_noop(self) -> None:
        """The helper rewrites the staged hook to a no-op (``true``)."""
        with tempfile.TemporaryDirectory(
            prefix="clinemm-correction06-helper-"
        ) as td:
            apps = Path(td) / "apps" / "vscode"
            apps.mkdir(parents=True)
            staged_pkg = apps / "package.json"
            # Pre-seed the manifest with a realistic scripts block.
            staged_pkg.write_text(
                json.dumps(
                    {
                        "name": "clinemm",
                        "version": "4.1.10",
                        "scripts": {
                            "vscode:prepublish": "bun run check-types",
                        },
                    },
                    indent=2,
                )
                + "\n"
            )

            disable_vscode_prepublish_hook(staged_pkg)

            data = json.loads(staged_pkg.read_text())
            self.assertIn("scripts", data)
            self.assertEqual(
                data["scripts"]["vscode:prepublish"],
                "true",
                msg=(
                    "disable_vscode_prepublish_hook must neuter the "
                    "vscode:prepublish hook to a no-op (true)"
                ),
            )

    def test_neuter_preserves_other_keys(self) -> None:
        """Sibling invariant to write_package_version: the helper does
        NOT collapse other keys. The staged manifest stays well-formed
        for the subsequent vsce package call."""
        with tempfile.TemporaryDirectory(
            prefix="clinemm-correction06-helper-"
        ) as td:
            apps = Path(td) / "apps" / "vscode"
            apps.mkdir(parents=True)
            pkg = apps / "package.json"
            pkg.write_text(
                json.dumps(
                    {
                        "name": "clinemm",
                        "version": "4.1.10",
                        "publisher": "s1onique",
                        "scripts": {
                            "vscode:prepublish": "bun run check-types",
                            "build": "bun esbuild.mjs --production",
                        },
                    },
                    indent=2,
                )
                + "\n"
            )

            disable_vscode_prepublish_hook(pkg)

            data = json.loads(pkg.read_text())
            self.assertEqual(data["name"], "clinemm")
            self.assertEqual(data["version"], "4.1.10")
            self.assertEqual(data["publisher"], "s1onique")
            self.assertEqual(data["scripts"]["vscode:prepublish"], "true")
            self.assertEqual(
                data["scripts"]["build"], "bun esbuild.mjs --production"
            )

    def test_neuter_is_idempotent(self) -> None:
        """Calling the helper twice keeps the hook neutered and does
        not corrupt the manifest."""
        with tempfile.TemporaryDirectory(
            prefix="clinemm-correction06-helper-"
        ) as td:
            apps = Path(td) / "apps" / "vscode"
            apps.mkdir(parents=True)
            staged_pkg = apps / "package.json"
            staged_pkg.write_text(
                json.dumps(
                    {
                        "name": "clinemm",
                        "version": "4.1.10",
                        "scripts": {
                            "vscode:prepublish": "bun run check-types",
                        },
                    },
                    indent=2,
                )
                + "\n"
            )

            disable_vscode_prepublish_hook(staged_pkg)
            first = staged_pkg.read_bytes()
            disable_vscode_prepublish_hook(staged_pkg)
            second = staged_pkg.read_bytes()

            self.assertEqual(
                first,
                second,
                msg=(
                    "disable_vscode_prepublish_hook must be idempotent "
                    "(second call must not change bytes)"
                ),
            )
            data = json.loads(second)
            self.assertEqual(data["scripts"]["vscode:prepublish"], "true")


class TestCorrection06OrchestratorUnconditionalNeuter(unittest.TestCase):
    """C06-I2 / C06-I3 / C06-I4: orchestrator MUST neuter the
    staged vscode:prepublish hook unconditionally, regardless of
    skip_typecheck, before vsce package. Source pkg.json must be
    byte-identical.
    """

    def _drive_orchestrator(self, *, skip_typecheck):
        visible_trace = []
        neuter_observations = []

        with tempfile.TemporaryDirectory(
            prefix="clinemm-correction06-orch-"
        ) as tmp:
            tmp = Path(tmp)
            repo = tmp / "repo"
            repo.mkdir()
            source_pkg = _write_package_json(
                repo / "apps" / "vscode", version="4.1.10"
            )
            pinned_source_pkg_bytes = source_pkg.read_bytes()
            out = tmp / "out"
            out.mkdir()

            def fake_cmd(argv, cwd):
                if argv[:3] == ["git", "rev-parse", "--short"]:
                    return "2f3bdfeee"
                if argv[:2] == ["git", "rev-parse"]:
                    return (
                        "abcdef1234567890abcdef1234567890abcdef12"
                    )
                if argv[:2] == ["git", "status"]:
                    return ""
                if argv[:3] == ["git", "worktree", "add"]:
                    wstage = Path(argv[4])
                    wstage.mkdir(parents=True, exist_ok=True)
                    apps = wstage / "apps" / "vscode"
                    apps.mkdir(parents=True, exist_ok=True)
                    _write_package_json(apps, version="4.1.10")
                    _seed_staged_prepublish_hook(apps)
                    _write_tracked_elm_sources(wstage)
                    (apps / "dist").mkdir(parents=True, exist_ok=True)
                    dogfood_version = derive_dogfood_version(
                        "4.1.10", "2f3bdfeee"
                    )
                    staged_vsix = apps / "dist" / default_dogfood_vsix_name(
                        "clinemm", dogfood_version
                    )
                    _make_vsix(staged_vsix, version=dogfood_version)
                    return ""
                if argv[:3] == ["git", "worktree", "remove"]:
                    shutil.rmtree(argv[4], ignore_errors=True)
                    return ""
                return ""

            def fake_visible(argv, cwd):
                visible_trace.append((list(argv), Path(cwd)))
                if argv[:3] == ["git", "worktree", "add"]:
                    wstage = Path(argv[4])
                    wstage.mkdir(parents=True, exist_ok=True)
                    apps = wstage / "apps" / "vscode"
                    apps.mkdir(parents=True, exist_ok=True)
                    _write_package_json(apps, version="4.1.10")
                    _seed_staged_prepublish_hook(apps)
                    _write_tracked_elm_sources(wstage)
                    return

            import build_dogfood_vsix_lib as lib

            original_disable = lib.disable_vscode_prepublish_hook

            def recording_disable(staged_pkg):
                original_disable(staged_pkg)
                try:
                    data = json.loads(staged_pkg.read_text())
                    hook_value = (
                        data.get("scripts", {}).get("vscode:prepublish")
                        if isinstance(data, dict)
                        else None
                    )
                except (OSError, json.JSONDecodeError):
                    hook_value = None
                neuter_observations.append((hook_value, staged_pkg))

            original_build = lib.build_elm_kernel
            original_vsce = lib.vsce_package

            def recording_build(stage, *, run_visible=None):
                visible_trace.append(
                    (["BUILD-ELM-KERNEL-INVOKED"], Path(stage))
                )
                apps = stage
                src_dir = (
                    apps / "elm" / "completion-authority" / "vendor"
                )
                src_dir.mkdir(parents=True, exist_ok=True)
                js_bytes = b"recording-build-payload-bytes"
                src_dir.joinpath(
                    "completion-authority.js"
                ).write_bytes(js_bytes)
                sha = compute_sha256_bytes(js_bytes)
                src_dir.joinpath(
                    "completion-authority.js.sha256"
                ).write_text(sha + "\n")

            def recording_vsce(stage_apps_vscode, staged_vsix_out, **_kw):
                visible_trace.append(
                    (
                        ["VSCE-PACKAGE-INVOKED", str(staged_vsix_out)],
                        Path(stage_apps_vscode),
                    )
                )

            lib.disable_vscode_prepublish_hook = recording_disable
            lib.build_elm_kernel = recording_build
            lib.vsce_package = recording_vsce
            try:
                try:
                    build_dogfood_vsix(
                        repo=repo,
                        output_dir=out,
                        run_cmd=fake_cmd,
                        run_visible=fake_visible,
                        skip_typecheck=skip_typecheck,
                    )
                except BuildError:
                    pass
            finally:
                lib.disable_vscode_prepublish_hook = original_disable
                lib.build_elm_kernel = original_build
                lib.vsce_package = original_vsce

            current_source_bytes = source_pkg.read_bytes()
            self.assertEqual(
                current_source_bytes,
                pinned_source_pkg_bytes,
                msg=(
                    "CORRECTION06: source package.json must NEVER be "
                    "mutated by the orchestrator (DOGFOOD03 / "
                    f"DOGFOOD03b); got {len(current_source_bytes)} != "
                    f"{len(pinned_source_pkg_bytes)}"
                ),
            )

        return source_pkg, visible_trace, neuter_observations

    def test_neuter_runs_with_skip_typecheck_true(self):
        """The helper is invoked when skip_typecheck=True (regression
        guard for the existing CORRECTION04 path)."""
        _source_pkg, _visible_trace, neuter_observations = (
            self._drive_orchestrator(skip_typecheck=True)
        )
        self.assertTrue(
            len(neuter_observations) >= 1,
            msg=(
                "disable_vscode_prepublish_hook must be invoked by "
                "the orchestrator when skip_typecheck=True; got "
                f"observations={neuter_observations!r}"
            ),
        )
        for hook_value, _staged_pkg in neuter_observations:
            self.assertEqual(
                hook_value,
                "true",
                msg=(
                    "disable_vscode_prepublish_hook must set the "
                    "staged hook to 'true'; "
                    f"got hook_value={hook_value!r}"
                ),
            )

    def test_neuter_runs_with_skip_typecheck_false(self):
        """CORRECTION06 NEW BEHAVIOUR: helper is invoked even when
        skip_typecheck=False (canonical prepublish has just run).
        This is the fix."""
        _source_pkg, _visible_trace, neuter_observations = (
            self._drive_orchestrator(skip_typecheck=False)
        )
        self.assertTrue(
            len(neuter_observations) >= 1,
            msg=(
                "CORRECTION06: disable_vscode_prepublish_hook must "
                "be invoked by the orchestrator unconditionally; "
                "with skip_typecheck=False it is the only thing "
                "preventing vsce package from re-running prepublish. "
                f"Got observations={neuter_observations!r}"
            ),
        )
        for hook_value, _staged_pkg in neuter_observations:
            self.assertEqual(
                hook_value,
                "true",
                msg=(
                    "CORRECTION06: disable_vscode_prepublish_hook "
                    "must set the staged hook to 'true'; "
                    f"got hook_value={hook_value!r}"
                ),
            )

    def test_neuter_occurs_after_canonical_build_before_vsce(self):
        """C06-I4: canonical prepublish runs BEFORE vsce package."""
        _source_pkg, visible_trace, _neuter_observations = (
            self._drive_orchestrator(skip_typecheck=False)
        )

        prepublish_idx = None
        vsce_idx = None
        for i, (argv, _cwd) in enumerate(visible_trace):
            if argv[:3] == ["bun", "run", "vscode:prepublish"]:
                prepublish_idx = i
            if argv and argv[0] == "VSCE-PACKAGE-INVOKED":
                vsce_idx = i

        self.assertIsNotNone(
            prepublish_idx,
            msg=(
                "run_canonical_build must invoke "
                f"vscode:prepublish; trace={visible_trace!r}"
            ),
        )
        self.assertIsNotNone(
            vsce_idx,
            msg=(
                "vsce_package must be invoked by the orchestrator; "
                f"trace={visible_trace!r}"
            ),
        )
        self.assertLess(
            prepublish_idx,
            vsce_idx,
            msg=(
                "CORRECTION06 ordering invariant: the canonical "
                "prepublish must run BEFORE vsce package "
                "(so the neutering between them suppresses the "
                f"duplication). Got prepublish_idx={prepublish_idx} "
                f"vsce_idx={vsce_idx}"
            ),
        )

    def test_neuter_call_site_in_orchestrator_source(self):
        """Static source-grep guard: the orchestrator must call
        disable_vscode_prepublish_hook(stage_apps / "package.json")
        UNCONDITIONALLY (NOT inside an ``if skip_typecheck:`` block)."""
        import re as _re

        source = (
            Path(__file__).resolve().parent.parent
            / "build_dogfood_vsix_lib.py"
        ).read_text(encoding="utf-8")

        marker_re = _re.compile(
            r"^def build_dogfood_vsix\(", _re.MULTILINE
        )
        start = marker_re.search(source)
        if start is None:
            self.fail("could not locate build_dogfood_vsix")
        body = source[start.start(): start.start() + 8_000]

        self.assertIn(
            "disable_vscode_prepublish_hook(stage_apps / \"package.json\")",
            body,
            msg=(
                "build_dogfood_vsix must call "
                "disable_vscode_prepublish_hook(stage_apps / "
                "'package.json') for CORRECTION06"
            ),
        )

        forbidden_re = _re.compile(
            r"if\s+skip_typecheck\s*:\s*\n"
            r"(?:\s|#[^\n]*\n)*"
            r"disable_vscode_prepublish_hook\(",
            _re.MULTILINE,
        )
        self.assertIsNone(
            forbidden_re.search(body),
            msg=(
                "CORRECTION06: disable_vscode_prepublish_hook must "
                "be invoked UNCONDITIONALLY in build_dogfood_vsix. "
                "Re-introducing `if skip_typecheck:` around the "
                "neutering regresses CORRECTION06's structural fix."
            ),
        )

    def test_existing_skip_typecheck_behavior_conserved(self):
        """Conservation: the skip_typecheck shortcut still routes
        through the lower-level protos+build:webview+esbuild path,
        NOT vscode:prepublish. This is the CORRECTION03 invariant
        that CORRECTION06 must NOT regress."""
        _source_pkg, visible_trace, _neuter_observations = (
            self._drive_orchestrator(skip_typecheck=True)
        )
        # When skip_typecheck=True, the canonical build invokes the
        # lower-level path; it should NOT invoke the full
        # vscode:prepublish hook (which would re-trigger the
        # typecheck gate).
        for argv, _cwd in visible_trace:
            self.assertNotEqual(
                argv[:3] if len(argv) >= 3 else [],
                ["bun", "run", "vscode:prepublish"],
                msg=(
                    "CORRECTION03 conservation: skip_typecheck=True "
                    "must NOT route through vscode:prepublish (which "
                    "runs the full typecheck); got argv={argv!r}"
                ),
            )


class TestDogfood06PayloadExtensionJs(unittest.TestCase):
    """D09 / DOGFOOD06: missing ``extension/dist/extension.js`` is a
    build failure that must raise BuildError."""

    def test_present_passes(self) -> None:
        # Should not raise.
        verify_vsix_payload(
            {
                "extension/dist/extension.js",
                "extension/webview-ui/build/assets/index.js",
                # ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION03:
                # Elm kernel entries are staged into the package-owned
                # runtime-assets/ directory (NOT the original
                # gitignored vendor/ location).
                "extension/runtime-assets/completion-authority.js",
                "extension/runtime-assets/completion-authority.js.sha256",
            }
        )

    def test_missing_extension_js_fails(self) -> None:
        with self.assertRaises(BuildError) as ctx:
            verify_vsix_payload(
                {
                    "extension/webview-ui/build/assets/index.js",
                }
            )
        self.assertIn("extension/dist/extension.js", str(ctx.exception))


# =============================================================================
# DOGFOOD07 — payload must include at least one webview asset
# =============================================================================


class TestDogfood07PayloadWebviewAssets(unittest.TestCase):
    """D09 / DOGFOOD07: the webview assets directory must have at
    least one entry."""

    def test_present_passes(self) -> None:
        # Should not raise.
        verify_vsix_payload(
            {
                "extension/dist/extension.js",
                "extension/webview-ui/build/assets/index.js",
                "extension/webview-ui/build/assets/index.css",
                # ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION03:
                # Elm kernel entries are staged into the package-owned
                # runtime-assets/ directory (NOT the original
                # gitignored vendor/ location).
                "extension/runtime-assets/completion-authority.js",
                "extension/runtime-assets/completion-authority.js.sha256",
            }
        )

    def test_missing_webview_assets_fails(self) -> None:
        with self.assertRaises(BuildError) as ctx:
            verify_vsix_payload({"extension/dist/extension.js"})
        self.assertIn("webview-ui/build/assets", str(ctx.exception))


# =============================================================================
# DOGFOOD-KERNEL — payload must include the Elm kernel bundle
#
# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION03
# (PACKAGING-DISCOVERY) pins the runtime invariant that the Elm
# kernel JS bundle is present in the VSIX at the staged runtime
# asset location (``extension/runtime-assets/completion-authority.js``
# + ``.sha256`` sidecar). The activation code in
# apps/vscode/src/extension.ts:activate loads
# `runtime-assets/completion-authority.js` relative to
# context.extensionUri.fsPath when
# CLINEMM_COMPLETION_AUTHORITY_ELM_SHADOW=1 is set, so a missing
# kernel bundle at activation time is a P1 packaging defect that
# must be caught at build time. verify_vsix_payload enforces this.
#
# Why the staged location and not the original
# `elm/completion-authority/vendor/completion-authority.js`:
# the source kernel lives under a nested .gitignore
# (`vendor/*.js`, `vendor/*.sha256`). vsce applies .gitignore
# semantics during file DISCOVERY, before .vscodeignore runs, so
# the original location is invisible to vsce regardless of any
# `.vscodeignore !negation`. The staging happens in
# stage_elm_kernel_runtime_asset() inside the temporary detached
# worktree, immediately before `vsce package`.
# =============================================================================


class TestDogfoodKernelElmKernelBundle(unittest.TestCase):
    """D09 / DOGFOOD-KERNEL: missing
    ``extension/runtime-assets/completion-authority.js``
    is a build failure that must raise BuildError. The
    ``.sha256`` sidecar is also required so the runtime can verify
    the kernel bytes."""

    def test_present_passes(self) -> None:
        # Should not raise.
        verify_vsix_payload(
            {
                "extension/dist/extension.js",
                "extension/webview-ui/build/assets/index.js",
                "extension/runtime-assets/completion-authority.js",
                "extension/runtime-assets/completion-authority.js.sha256",
            }
        )

    def test_missing_kernel_js_fails(self) -> None:
        with self.assertRaises(BuildError) as ctx:
            verify_vsix_payload(
                {
                    "extension/dist/extension.js",
                    "extension/webview-ui/build/assets/index.js",
                    # kernel JS missing on purpose
                    "extension/runtime-assets/completion-authority.js.sha256",
                }
            )
        self.assertIn(
            "extension/runtime-assets/completion-authority.js",
            str(ctx.exception),
        )

    def test_missing_kernel_sha_fails(self) -> None:
        with self.assertRaises(BuildError) as ctx:
            verify_vsix_payload(
                {
                    "extension/dist/extension.js",
                    "extension/webview-ui/build/assets/index.js",
                    "extension/runtime-assets/completion-authority.js",
                    # kernel sha missing on purpose
                }
            )
        self.assertIn(
            "extension/runtime-assets/completion-authority.js.sha256",
            str(ctx.exception),
        )

    def test_legacy_vendor_path_no_longer_satisfies(self) -> None:
        """ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION03:
        the OLD vendor path (under the nested .gitignore) is no
        longer a valid VSIX location for the kernel. The runtime
        loads from ``runtime-assets/``; if the staged copy is
        missing, the build must fail even if the unfiltered
        vendor/ path were somehow present. This pins the new
        contract: only the staged location counts."""
        with self.assertRaises(BuildError) as ctx:
            verify_vsix_payload(
                {
                    "extension/dist/extension.js",
                    "extension/webview-ui/build/assets/index.js",
                    # ONLY the legacy vendor path is present, not
                    # the staged runtime-assets/ location — must fail.
                    "extension/elm/completion-authority/vendor/completion-authority.js",
                    "extension/elm/completion-authority/vendor/completion-authority.js.sha256",
                }
            )
        self.assertIn(
            "extension/runtime-assets/completion-authority.js",
            str(ctx.exception),
        )


class TestDogfoodKernel04StageRuntimeAsset(unittest.TestCase):
    """DOGFOOD-KERNEL-04: stage_elm_kernel_runtime_asset must copy
    the source Elm kernel JS + SHA sidecar from the gitignored
    ``elm/completion-authority/vendor/`` directory into the
    package-owned ``runtime-assets/`` directory inside the staged
    worktree, and the SHA of the staged JS bytes must equal the
    staged ``.sha256`` sidecar.

    ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION03
    (PACKAGING-DISCOVERY). This is the bounded fix that replaces
    the inert `.vscodeignore !negation` strategy — by staging into
    a non-gitignored package-owned directory we sidestep vsce's
    .gitignore-vs-.vscodeignore precedence entirely.
    """

    @staticmethod
    def _write_source(root: Path, *, js_bytes: bytes, sha: str) -> None:
        src_dir = root / "elm" / "completion-authority" / "vendor"
        src_dir.mkdir(parents=True, exist_ok=True)
        (src_dir / "completion-authority.js").write_bytes(js_bytes)
        (src_dir / "completion-authority.js.sha256").write_text(sha + "\n")

    def test_stages_js_and_sha_and_sha_matches(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-04-"
        ) as td:
            stage = Path(td)
            js_bytes = (
                b"this-is-a-fake-elm-kernel-payload-034f70b7b725738b"
            )
            expected_sha = compute_sha256_bytes(js_bytes)
            self._write_source(
                stage, js_bytes=js_bytes, sha=expected_sha
            )

            returned_sha = stage_elm_kernel_runtime_asset(stage)

            staged_js = (
                stage / "runtime-assets" / "completion-authority.js"
            )
            staged_sha = (
                stage / "runtime-assets" /
                "completion-authority.js.sha256"
            )
            self.assertTrue(staged_js.is_file(), "staged JS missing")
            self.assertTrue(
                staged_sha.is_file(), "staged SHA sidecar missing"
            )
            self.assertEqual(staged_js.read_bytes(), js_bytes)
            self.assertEqual(
                staged_sha.read_text().strip(), expected_sha
            )
            self.assertEqual(returned_sha, expected_sha)

    def test_missing_source_js_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-04-"
        ) as td:
            stage = Path(td)
            # Only the SHA sidecar is present; the JS is missing.
            src_dir = stage / "elm" / "completion-authority" / "vendor"
            src_dir.mkdir(parents=True, exist_ok=True)
            (src_dir / "completion-authority.js.sha256").write_text(
                "deadbeef" * 8 + "\n"
            )
            with self.assertRaises(BuildError) as ctx:
                stage_elm_kernel_runtime_asset(stage)
            self.assertIn(
                "Elm kernel source missing", str(ctx.exception)
            )

    def test_missing_source_sha_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-04-"
        ) as td:
            stage = Path(td)
            src_dir = stage / "elm" / "completion-authority" / "vendor"
            src_dir.mkdir(parents=True, exist_ok=True)
            (src_dir / "completion-authority.js").write_bytes(b"x" * 16)
            # No .sha256 sidecar.
            with self.assertRaises(BuildError) as ctx:
                stage_elm_kernel_runtime_asset(stage)
            self.assertIn(
                "Elm kernel source SHA missing", str(ctx.exception)
            )

    def test_sha_sidecar_mismatch_fails_closed(self) -> None:
        """If the .sha256 sidecar disagrees with the staged JS
        bytes, fail closed. This guards against a future
        build-elm.sh format change silently emitting a stale
        sidecar."""
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-04-"
        ) as td:
            stage = Path(td)
            js_bytes = b"actual-payload-bytes"
            wrong_sha = compute_sha256_bytes(b"different-payload-bytes")
            self._write_source(
                stage, js_bytes=js_bytes, sha=wrong_sha
            )
            with self.assertRaises(BuildError) as ctx:
                stage_elm_kernel_runtime_asset(stage)
            self.assertIn("sidecar mismatch", str(ctx.exception))


# =============================================================================
# DOGFOOD-KERNEL-05 — build_elm_kernel must run inside the staged worktree
# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION04
# (WORKTREE-KERNEL-BUILD). A git linked worktree (``git worktree add
# --detach``) is a checkout of the chosen commit, NOT a copy of
# arbitrary generated / ignored files. The Elm kernel bundle lives
# under a nested gitignore (``apps/vscode/elm/completion-authority/
# vendor/*.js``), so it is absent from the staged worktree at the
# moment the orchestrator needs it. We must build the kernel FROM
# the tracked Elm sources inside the staged worktree immediately
# before staging it.
# =============================================================================


def _write_tracked_elm_sources(root: Path) -> Path:
    """Create the minimal tracked Elm layout so ``build_elm_kernel``
    can locate ``elm/completion-authority/scripts/build-elm.sh``.
    Returns the apps/vscode root inside ``root``."""
    apps = root / "apps" / "vscode"
    scripts_dir = (
        apps / "elm" / "completion-authority" / "scripts"
    )
    scripts_dir.mkdir(parents=True, exist_ok=True)
    script = scripts_dir / "build-elm.sh"
    script.write_text(
        "#!/usr/bin/env bash\n"
        "# stub for DOGFOOD-KERNEL-05 tests; real build is in the\n"
        "# canonical repo and runs via the same helper.\n"
        "exit 0\n"
    )
    script.chmod(0o755)
    return apps


class TestDogfoodKernel05BuildElmKernel(unittest.TestCase):
    """DOGFOOD-KERNEL-05: pin the bounded contract
    ``build_elm_kernel(stage_apps_vscode)``:

    1. ``build occurs before stage`` — orchestrator command trace
       shows ``build-elm.sh`` invoked BEFORE `stage_elm_kernel_runtime_asset`.
    2. ``build failure aborts package`` — a faked non-zero exit
       raises ``BuildError`` and the package step never runs.
    3. ``build success + missing artifact still fails closed`` — even
       if the runner exits 0 but writes nothing, the downstream
       staging call still raises ``BuildError``. The byte/SHA
       authority remains :func:`stage_elm_kernel_runtime_asset`.
    4. ``canonical worktree remains untouched`` — the helper runs
       with ``cwd=stage_apps_vscode``, never ``cwd=canonical_repo``.

    No new Elm build implementation in Python: ``build_elm_kernel`` only
    invokes the tracked shell script (or its test seam substitute).
    """

    def test_helper_invokes_tracked_build_elm_script(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-05-"
        ) as td:
            stage = Path(td)
            apps = _write_tracked_elm_sources(stage)
            trace: list[tuple[list[str], Path]] = []

            def record(argv, cwd):
                trace.append((list(argv), Path(cwd)))

            build_elm_kernel(apps, run_visible=record)

            self.assertEqual(len(trace), 1)
            argv, cwd = trace[0]
            self.assertEqual(len(argv), 1)
            self.assertTrue(
                argv[0].endswith(
                    "elm/completion-authority/scripts/build-elm.sh"
                ),
                msg=f"unexpected argv[0]: {argv[0]!r}",
            )
            self.assertEqual(cwd, Path(apps))

    def test_helper_fails_closed_when_build_script_missing(self) -> None:
        """No tracked ``build-elm.sh`` => ``BuildError`` from the
        helper itself, before the runner is even invoked."""
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-05-"
        ) as td:
            apps = Path(td) / "apps" / "vscode"
            apps.mkdir(parents=True)
            with self.assertRaises(BuildError) as ctx:
                build_elm_kernel(apps, run_visible=lambda a, c: None)
            self.assertIn("Elm build script missing", str(ctx.exception))

    def test_helper_propagates_build_failure(self) -> None:
        """When the runner simulates a non-zero exit (e.g. Elm not on
        PATH inside the staged worktree), the helper propagates the
        error. Tests substitute ``run_visible`` to assert the same
        contract that ``_default_run`` provides in production.
        """
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-05-"
        ) as td:
            apps = _write_tracked_elm_sources(Path(td))

            def boom(argv, cwd):
                raise BuildError(
                    f"simulated elm build failure: {argv}"
                )

            with self.assertRaises(BuildError) as ctx:
                build_elm_kernel(apps, run_visible=boom)
            self.assertIn(
                "simulated elm build failure", str(ctx.exception)
            )

    def test_helper_does_not_touch_canonical_repo(self) -> None:
        """Canonical worktree invariant: ``build_elm_kernel`` never
        invokes a subprocess with ``cwd=canonical_repo``. We feed a
        distinct canonical repo path and assert none of the
        recorded (argv, cwd) pairs have cwd inside it.
        """
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-05-"
        ) as outer:
            canonical = Path(outer) / "canonical"
            canonical.mkdir()
            (canonical / "apps" / "vscode" / "elm").mkdir(parents=True)
            stage_apps = _write_tracked_elm_sources(
                Path(outer) / "stage"
            )

            def record(argv, cwd):
                self.assertFalse(
                    Path(cwd).resolve().is_relative_to(
                        canonical.resolve()
                    ),
                    msg=(
                        "build_elm_kernel must not invoke subprocesses "
                        "with cwd inside the canonical repo; got "
                        f"cwd={cwd} argv={argv}"
                    ),
                )

            build_elm_kernel(stage_apps, run_visible=record)

    def test_helper_build_failure_aborts_package(self) -> None:
        """End-to-end via the orchestrator: a failing ``build_elm_kernel``
        short-circuits the build before ``vsce_package`` runs.

        We patch ``lib.build_elm_kernel`` to raise ``BuildError`` and
        assert (a) the orchestrator surfaces the same error, and
        (b) ``vsce package`` does NOT appear in the visible trace.
        """
        visible_trace: list[tuple[list[str], Path]] = []

        def fake_cmd(argv, cwd):
            if argv[:3] == ["git", "rev-parse", "--short"]:
                return "2f3bdfeee"
            if argv[:2] == ["git", "rev-parse"]:
                return (
                    "abcdef1234567890abcdef1234567890abcdef12"
                )
            if argv[:3] == ["git", "worktree", "add"]:
                wstage = Path(argv[4])
                wstage.mkdir(parents=True, exist_ok=True)
                apps = wstage / "apps" / "vscode"
                apps.mkdir(parents=True, exist_ok=True)
                _write_package_json(apps, version="4.1.10")
                _write_tracked_elm_sources(wstage)
                (apps / "dist").mkdir(parents=True, exist_ok=True)
                dogfood_version = derive_dogfood_version(
                    "4.1.10", "2f3bdfeee"
                )
                staged_vsix = apps / "dist" / default_dogfood_vsix_name(
                    "clinemm", dogfood_version
                )
                _make_vsix(staged_vsix, version=dogfood_version)
                return ""
            if argv[:3] == ["git", "worktree", "remove"]:
                shutil.rmtree(argv[4], ignore_errors=True)
                return ""
            return ""

        def fake_visible(argv, cwd):
            visible_trace.append((list(argv), Path(cwd)))
            if argv[:3] == ["git", "worktree", "add"]:
                wstage = Path(argv[4])
                wstage.mkdir(parents=True, exist_ok=True)
                apps = wstage / "apps" / "vscode"
                apps.mkdir(parents=True, exist_ok=True)
                _write_package_json(apps, version="4.1.10")
                _write_tracked_elm_sources(wstage)
                return

        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            repo = tmp / "repo"
            repo.mkdir()
            _write_package_json(
                repo / "apps" / "vscode", version="4.1.10"
            )
            out = tmp / "out"
            out.mkdir()

            import build_dogfood_vsix_lib as lib

            original = lib.build_elm_kernel

            def failing_build(stage, *, run_visible=None):
                raise BuildError("simulated elm build abort")

            lib.build_elm_kernel = failing_build
            try:
                with self.assertRaises(BuildError) as ctx:
                    build_dogfood_vsix(
                        repo=repo,
                        output_dir=out,
                        run_cmd=fake_cmd,
                        run_visible=fake_visible,
                    )
            finally:
                lib.build_elm_kernel = original

        self.assertIn(
            "simulated elm build abort", str(ctx.exception)
        )
        for argv, _ in visible_trace:
            self.assertFalse(
                len(argv) >= 2 and argv[1] == "package",
                msg=(
                    "vsce package must not run after build_elm_kernel "
                    f"failure; got argv={argv!r}"
                ),
            )
    def test_helper_build_occurs_before_stage_in_orchestrator(self) -> None:
            """Orchestrator ordering invariant: ``build_elm_kernel`` is
            invoked BEFORE ``stage_elm_kernel_runtime_asset``."""
            visible_trace: list[tuple[list[str], Path]] = []

            def fake_cmd(argv, cwd):
                if argv[:3] == ["git", "rev-parse", "--short"]:
                    return "2f3bdfeee"
                if argv[:2] == ["git", "rev-parse"]:
                    return (
                        "abcdef1234567890abcdef1234567890abcdef12"
                    )
                if argv[:3] == ["git", "worktree", "add"]:
                    wstage = Path(argv[4])
                    wstage.mkdir(parents=True, exist_ok=True)
                    apps = wstage / "apps" / "vscode"
                    apps.mkdir(parents=True, exist_ok=True)
                    _write_package_json(apps, version="4.1.10")
                    _write_tracked_elm_sources(wstage)
                    (apps / "dist").mkdir(parents=True, exist_ok=True)
                    dogfood_version = derive_dogfood_version(
                        "4.1.10", "2f3bdfeee"
                    )
                    staged_vsix = apps / "dist" / default_dogfood_vsix_name(
                        "clinemm", dogfood_version
                    )
                    _make_vsix(staged_vsix, version=dogfood_version)
                    return ""
                if argv[:3] == ["git", "worktree", "remove"]:
                    shutil.rmtree(argv[4], ignore_errors=True)
                    return ""
                return ""

            def fake_visible(argv, cwd):
                visible_trace.append((list(argv), Path(cwd)))
                if argv[:3] == ["git", "worktree", "add"]:
                    wstage = Path(argv[4])
                    wstage.mkdir(parents=True, exist_ok=True)
                    apps = wstage / "apps" / "vscode"
                    apps.mkdir(parents=True, exist_ok=True)
                    _write_package_json(apps, version="4.1.10")
                    _write_tracked_elm_sources(wstage)
                    return

            with tempfile.TemporaryDirectory() as tmp:
                tmp = Path(tmp)
                repo = tmp / "repo"
                repo.mkdir()
                _write_package_json(
                    repo / "apps" / "vscode", version="4.1.10"
                )
                out = tmp / "out"
                out.mkdir()

                import build_dogfood_vsix_lib as lib

                original = lib.build_elm_kernel

                def recording_build(stage, *, run_visible=None):
                    visible_trace.append(
                        (["BUILD-ELM-KERNEL-INVOKED"], Path(stage))
                    )
                    apps = stage
                    src_dir = (
                        apps / "elm" / "completion-authority" / "vendor"
                    )
                    src_dir.mkdir(parents=True, exist_ok=True)
                    js_bytes = b"recording-build-payload-bytes"
                    src_dir.joinpath(
                        "completion-authority.js"
                    ).write_bytes(js_bytes)
                    sha = compute_sha256_bytes(js_bytes)
                    src_dir.joinpath(
                        "completion-authority.js.sha256"
                    ).write_text(sha + "\n")

                lib.build_elm_kernel = recording_build
                try:
                    try:
                        build_dogfood_vsix(
                            repo=repo,
                            output_dir=out,
                            run_cmd=fake_cmd,
                            run_visible=fake_visible,
                        )
                    except BuildError:
                        pass
                finally:
                    lib.build_elm_kernel = original

            build_idx = None
            for i, (argv, _) in enumerate(visible_trace):
                if argv and argv[0] == "BUILD-ELM-KERNEL-INVOKED":
                    build_idx = i
                    break
            self.assertIsNotNone(
                build_idx,
                msg="build_elm_kernel was not invoked by the orchestrator",
            )
            for argv, _ in visible_trace[:build_idx]:
                self.assertNotEqual(
                    argv[:2] if len(argv) >= 2 else argv,
                    ["vsce", "package"],
                    msg=(
                        "vsce package must not run before "
                        f"build_elm_kernel; got argv={argv!r}"
                    ),
                )


class TestDogfoodKernel05bBuildSuccessMissingArtifactFailsClosed(
    unittest.TestCase
):
    """``build_elm_kernel`` returning success must NOT bypass the
    :func:`stage_elm_kernel_runtime_asset` fail-closed contract.

    The staging helper is the *only* authority for byte/SHA
    validation. A build that claims success but produces no
    ``.js`` artifact must still be caught at staging time.
    """

    def test_build_success_no_artifact_still_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-05b-"
        ) as td:
            apps = _write_tracked_elm_sources(Path(td))

            def fake_success(argv, cwd):
                return None

            build_elm_kernel(apps, run_visible=fake_success)
            with self.assertRaises(BuildError) as ctx:
                stage_elm_kernel_runtime_asset(apps)
            self.assertIn(
                "Elm kernel source missing", str(ctx.exception)
            )

    def test_build_success_writes_artifact_staging_passes(self) -> None:
        with tempfile.TemporaryDirectory(
            prefix="clinemm-dogfood-kernel-05b-"
        ) as td:
            apps = _write_tracked_elm_sources(Path(td))

            js_bytes = b"kernel-bytes-from-build-034f70b7"
            expected_sha = compute_sha256_bytes(js_bytes)

            def fake_build(argv, cwd):
                src_dir = (
                    apps
                    / "elm"
                    / "completion-authority"
                    / "vendor"
                )
                src_dir.mkdir(parents=True, exist_ok=True)
                src_dir.joinpath(
                    "completion-authority.js"
                ).write_bytes(js_bytes)
                src_dir.joinpath(
                    "completion-authority.js.sha256"
                ).write_text(expected_sha + "\n")

            build_elm_kernel(apps, run_visible=fake_build)
            returned_sha = stage_elm_kernel_runtime_asset(apps)
            self.assertEqual(returned_sha, expected_sha)
            staged = (
                apps / "runtime-assets" / "completion-authority.js"
            )
            self.assertEqual(staged.read_bytes(), js_bytes)


def compute_sha256_bytes(data: bytes) -> str:
    """Helper: lowercase hex SHA-256 of raw bytes. Duplicates
    build_dogfood_vsix_lib.compute_sha256 for bytes input without
    taking a Path round-trip."""
    import hashlib

    return hashlib.sha256(data).hexdigest()


# =============================================================================
# DOGFOOD-KERNEL-05c — build-elm.sh must enter its HERE (the Elm project
# root) before invoking `elm make`.
# ACT-CLINEMM-COMPLETION-AUTHORITY-ELM-SHADOW02-CORRECTION05
# (ELM-PROJECT-CWD). The dogfood orchestrator invokes the tracked
# ``build-elm.sh`` with ``cwd=stage_apps_vscode`` (the parent of
# ``elm/completion-authority``), so Elm's compiler would otherwise
# start from ``apps/vscode`` and fail with ``-- NO elm.json FILE --``
# (the manifest lives at ``${HERE}/elm.json``). The fix is to enter
# ``HERE`` inside the shell script — the Python orchestrator stays
# untouched. This test pins that invariant against the tracked
# script bytes; no fake-Elm subprocess is required.
# =============================================================================


def _read_tracked_build_elm_script() -> str:
    """Return the text of the canonical ``build-elm.sh`` (the
    tracked one, not the test stub). The script lives at
    ``apps/vscode/elm/completion-authority/scripts/build-elm.sh``
    relative to the repository root — we resolve that from the
    library location, not from CWD, so the test is robust against
    being invoked from any working directory.
    """
    # build_dogfood_vsix_lib.py is at scripts/build_dogfood_vsix_lib.py
    # so the repo root is its parent.parent.
    repo_root = Path(__file__).resolve().parent.parent.parent
    script = (
        repo_root
        / "apps"
        / "vscode"
        / "elm"
        / "completion-authority"
        / "scripts"
        / "build-elm.sh"
    )
    return script.read_text(encoding="utf-8")


class TestDogfoodKernel05cBuildElmEntersProjectRoot(unittest.TestCase):
    """DOGFOOD-KERNEL-05c: pin the bounded contract that the tracked
    ``build-elm.sh`` enters its ``HERE`` directory (the Elm project
    root, where ``elm.json`` lives) before invoking ``elm make``.

    The orchestrator pins ``cwd=stage_apps_vscode`` — the parent of
    ``elm/`` — in :func:`build_elm_kernel`. Without an explicit
    ``cd "${HERE}"`` inside the shell script, Elm would start from
    the wrong directory and abort with ``-- NO elm.json FILE --``.
    We pin the textual invariant directly against the tracked
    script; the existing DOGFOOD-KERNEL-05 tests already pin the
    orchestrator's ``cwd`` contract.
    """

    def test_tracked_build_elm_script_cd_into_here_before_elm_make(
        self,
    ) -> None:
        script_text = _read_tracked_build_elm_script()
        # Locate the actual elm make invocation line and assert a
        # `cd "${HERE}"` appears strictly before it. We accept any
        # intervening comments / whitespace; the constraint is
        # ordering, not adjacency.
        elm_make_idx = script_text.find('"${ELM}" make')
        self.assertNotEqual(
            elm_make_idx,
            -1,
            msg=(
                "tracked build-elm.sh no longer contains the "
                'expected "${ELM}" make invocation'
            ),
        )
        cd_here_idx = script_text.find('cd "${HERE}"')
        self.assertNotEqual(
            cd_here_idx,
            -1,
            msg=(
                "CORRECTION05 regression: tracked build-elm.sh "
                'must `cd "${HERE}"` (the Elm project root) '
                "before invoking elm make; otherwise Elm starts "
                "from the orchestrator's cwd and aborts with "
                '"-- NO elm.json FILE --"'
            ),
        )
        self.assertLess(
            cd_here_idx,
            elm_make_idx,
            msg=(
                "CORRECTION05 regression: `cd \"${HERE}\"` must "
                "appear BEFORE the elm make line, not after"
            ),
        )

    def test_tracked_build_elm_script_must_not_relax_cwd_contract(
        self,
    ) -> None:
        """Defensive pin: the script must not silently `cd` to a
        directory other than ``HERE`` before invoking elm make.
        The orchestrator pins ``stage_apps_vscode`` as the caller
        cwd; the script is responsible for entering the Elm
        project root on its own. A drift like ``cd "${ELM}"`` or
        ``cd /tmp`` would re-introduce the same defect under a
        different name.
        """
        script_text = _read_tracked_build_elm_script()
        elm_make_idx = script_text.find('"${ELM}" make')
        self.assertNotEqual(elm_make_idx, -1)
        prefix = script_text[:elm_make_idx]
        # Strip comment lines (`#`) so this test is robust against
        # explanatory comment drift.
        code_lines = [
            line
            for line in prefix.splitlines()
            if line.strip() and not line.lstrip().startswith("#")
        ]
        cd_lines = [
            line.strip()
            for line in code_lines
            if line.strip().startswith("cd ")
        ]
        self.assertTrue(
            any('"${HERE}"' in line for line in cd_lines),
            msg=(
                "CORRECTION05 regression: tracked build-elm.sh "
                "must enter the Elm project root via "
                '`cd "${HERE}"` (not e.g. `cd /tmp` or '
                "`cd ${ELM}`) before invoking elm make; "
                f"observed cd lines: {cd_lines!r}"
            ),
        )

    def test_tracked_build_elm_script_emits_sha_only_sidecars(
        self,
    ) -> None:
        """CORRECTION05 follow-on: the tracked build-elm.sh must
        emit sidecars whose content is the bare lowercase hex
        SHA-256 followed by a single newline — never the
        ``<sha>  <path>`` shape that macOS ``shasum`` defaults to.

        The dogfood orchestrator's
        :func:`stage_elm_kernel_runtime_asset` reads the sidecar
        with ``.strip()`` and compares it byte-for-byte against
        ``compute_sha256(staged_js)``. A drift to
        ``shasum -a 256 FILE > FILE.sha256`` (no ``awk``) would
        re-introduce the SHA-sidecar mismatch guard failure.

        The test accepts either an explicit helper function or an
        inline ``awk '{print $1}'`` collapse — both produce the
        SHA-only shape that the orchestrator expects.
        """
        script_text = _read_tracked_build_elm_script()
        # The file MUST contain an awk-based collapse to bare hash.
        # Common acceptable forms:
        #   * shasum -a 256 FILE | awk '{print $1}' > FILE.sha256
        #   * shasum -a 256 FILE | cut -d' ' -f1 > FILE.sha256
        #   * sha256sum FILE | awk '{print $1}' > FILE.sha256
        # We accept any of these as long as the sidecar write is
        # followed by a transform that strips everything after the
        # first whitespace-separated token.
        lowered = script_text.lower()
        self.assertTrue(
            "awk" in lowered or "cut -d' ' -f1" in lowered,
            msg=(
                "CORRECTION05 sidecar-format regression: "
                "tracked build-elm.sh must collapse the shasum "
                "output to the bare hash (e.g. via "
                "`awk '{print $1}'`) before writing the "
                ".sha256 sidecar; otherwise macOS shasum "
                "emits `<sha>  <path>` and the orchestrator's "
                "SHA-sidecar mismatch guard will abort the "
                "package."
            ),
        )
        # Conversely, the raw `shasum ... > FILE.sha256` form
        # (without any pipeline) must NOT appear, since that is
        # exactly the macOS-default shape the orchestrator
        # rejects. We accept either:
        #   shasum ... | awk '{print $1}' > FILE.sha256
        # or any other pipeline-collapsed form.
        import re as _re

        # Capture every `shasum ... > ...sha256` line. If any
        # such line exists without an intervening `|` (pipeline)
        # that reaches an `awk`/`cut`/`tr` collapse before the
        # `>`, that is a regression.
        raw_lines = [
            ln
            for ln in script_text.splitlines()
            if "shasum" in ln and ">" in ln and ".sha256" in ln
        ]
        bad_lines = []
        for ln in raw_lines:
            # Split at the `>` redirect; everything before is
            # the producer side.
            producer = ln.split(">", 1)[0]
            # The producer must contain a `|` (pipeline) AND must
            # end with a bare-hash extractor (awk '{print $1}',
            # cut -d' ' -f1, or similar).
            if "|" not in producer:
                bad_lines.append(ln)
                continue
            tail = producer.split("|")[-1].strip()
            if not (
                "awk '{print $1}'" in tail
                or 'awk "{print $1}"' in tail
                or "cut -d' ' -f1" in tail
                or 'cut -d" " -f1' in tail
            ):
                bad_lines.append(ln)
        self.assertEqual(
            bad_lines,
            [],
            msg=(
                "CORRECTION05 sidecar-format regression: "
                "tracked build-elm.sh has one or more "
                "`shasum ... > FILE.sha256` redirects WITHOUT a "
                "prior `| awk '{print $1}'` collapse; macOS "
                "shasum defaults to `<sha>  <path>` and trips "
                "the orchestrator's SHA-sidecar mismatch "
                "guard. offending lines: "
                f"{bad_lines!r}"
            ),
        )


# =============================================================================
# DOGFOOD08 — install listing must contain the expected ns@version
# =============================================================================


class TestDogfood08InstallVerification(unittest.TestCase):
    """D11 / DOGFOOD08: the post-install listing must contain a line
    ``<ns_name>@<dogfood_version>`` exactly."""

    def test_present_passes(self) -> None:
        listing = (
            "some.other.extension@0.0.1\n"
            "s1onique.clinemm@4.1.10-2f3bdfeee\n"
            "another@1.2.3\n"
        )
        # Should not raise.
        verify_install_listing(
            listing, "s1onique.clinemm", "4.1.10-2f3bdfeee"
        )

    def test_missing_fails_closed(self) -> None:
        listing = (
            "some.other.extension@0.0.1\n"
            "another@1.2.3\n"
        )
        with self.assertRaises(BuildError) as ctx:
            verify_install_listing(
                listing, "s1onique.clinemm", "4.1.10-2f3bdfeee"
            )
        self.assertIn("installed extension not found", str(ctx.exception))
        self.assertIn(
            "s1onique.clinemm@4.1.10-2f3bdfeee", str(ctx.exception)
        )

    def test_partial_prefix_match_does_not_count(self) -> None:
        """A line that *starts with* the expected string but has
        extra trailing content must NOT be treated as the install
        listing line — the verifier requires line equality."""
        listing = "s1onique.clinemm@4.1.10-2f3bdfeee.dirty\n"
        with self.assertRaises(BuildError):
            verify_install_listing(
                listing, "s1onique.clinemm", "4.1.10-2f3bdfeee"
            )


# =============================================================================
# DOGFOOD09 — cleanup is invoked from the failure path
# =============================================================================


class TestDogfood09CleanupOnFailure(unittest.TestCase):
    """D12 / DOGFOOD09: when any orchestrator step raises, the
    temporary worktree and tempdir must still be cleaned up so the
    host filesystem is left tidy."""

    def _build_cleanup_observers(self):
        """Returns (log, fake_run, fake_visible). ``fake_visible``
        simulates ``vscode:prepublish`` and *raises* partway through
        the build to drive the failure path; ``fake_run`` simulates
        git plumbing (status / rev-parse / worktree add / worktree
        remove)."""
        log: list[str] = []

        def fake_run(argv, cwd, **_kwargs):
            if argv[:2] == ["git", "status"]:
                return ""
            if argv[:2] == ["git", "rev-parse"] and any(a.startswith("--short") for a in argv):
                return "2f3bdfeee"
            if argv[:2] == ["git", "rev-parse"] and argv[-1] == "HEAD":
                return "abcdef1234567890abcdef1234567890abcdef12"
            if argv[:3] == ["git", "worktree", "add"]:
                stage = Path(argv[4])
                stage.mkdir(parents=True, exist_ok=True)
                (stage / "marker.txt").write_text("worktree-marker\n")
                return ""
            if (
                argv[:2] == ["git", "rev-parse"]
                and len(argv) == 3
                and argv[2] != "HEAD"
            ):
                return "abcdef1234567890abcdef1234567890abcdef12"
            if argv[:3] == ["git", "worktree", "remove"]:
                log.append("worktree-remove:" + str(argv[4]))
                shutil.rmtree(argv[4], ignore_errors=True)
                return ""
            return ""

        def fake_visible(argv, cwd):
            if argv[:3] == ["git", "worktree", "remove"]:
                log.append("worktree-remove:" + str(argv[4]))
                shutil.rmtree(argv[4], ignore_errors=True)
                return
            if argv[:3] == ["git", "worktree", "add"]:
                # Drop a fake worktree on disk so cleanup has
                # something to remove.
                stage = Path(argv[4])
                stage.mkdir(parents=True, exist_ok=True)
                (stage / "marker.txt").write_text("worktree-marker\n")
                return
            if "vscode:prepublish" in argv:
                log.append("failed-step:vscode:prepublish")
                raise BuildError("simulated vscode:prepublish failure")

        return log, fake_run, fake_visible

    def test_exception_in_build_triggers_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            repo = tmp / "repo"
            repo.mkdir()
            _write_package_json(repo / "apps" / "vscode", version="4.1.10")

            log, fake_run, fake_visible = self._build_cleanup_observers()

            with self.assertRaises(BuildError) as ctx:
                build_dogfood_vsix(
                    repo=repo,
                    output_dir=tmp / "out",
                    run_cmd=fake_run,
                    run_visible=fake_visible,
                )
            self.assertIn(
                "simulated vscode:prepublish failure", str(ctx.exception)
            )

        self.assertTrue(
            any("worktree-remove" in entry for entry in log),
            msg=f"cleanup was not invoked on failure; log={log}",
        )
        self.assertIn("failed-step:vscode:prepublish", log)

    def test_remove_worktree_quietly_is_tolerant_of_already_gone(self) -> None:
        """A second cleanup attempt against an already-removed path
        must not raise — DOGFOOD09 also covers idempotent retries
        from nested finally blocks."""
        with tempfile.TemporaryDirectory() as tmp:
            fake_repo = Path(tmp)
            missing = fake_repo / "no-such-dir"
            # Should not raise.
            remove_worktree_quietly(fake_repo, missing)


# =============================================================================
# DOGFOOD10 — refusing to overwrite an existing artifact is honoured
# =============================================================================


class TestDogfood10ExistingArtifactRequiresForce(unittest.TestCase):
    """D10 / DOGFOOD10: the orchestrator must raise BuildError when
    the final artifact path already exists and ``force`` is False."""

    def test_refuses_existing_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            repo = tmp / "repo"
            repo.mkdir()
            _write_package_json(repo / "apps" / "vscode", version="4.1.10")
            output_dir = tmp / "out"
            output_dir.mkdir()
            dogfood_version = "4.1.10-2f3bdfeee"
            existing = output_dir / default_dogfood_vsix_name(
                "clinemm", dogfood_version
            )
            existing.write_bytes(b"\x00")

            def fake_run(argv, cwd, **_kwargs):
                if argv[:2] == ["git", "status"]:
                    return ""
                if argv[:2] == ["git", "rev-parse"] and any(a.startswith("--short") for a in argv):
                    return "2f3bdfeee"
                if argv[:2] == ["git", "rev-parse"] and argv[-1] == "HEAD":
                    return "abcdef1234567890abcdef1234567890abcdef12"
                # Note: the orchestrator must raise BuildError
                # "refusing to overwrite" before it gets to
                # `git worktree add`, so we deliberately do NOT
                # handle that here — if execution reaches it, the
                # default empty-string return would let the build
                # proceed, which would itself raise later. Either
                # way, the *intended* failure is the refuse.
                return ""

            with self.assertRaises(BuildError) as ctx:
                build_dogfood_vsix(
                    repo=repo,
                    output_dir=output_dir,
                    run_cmd=fake_run,
                    run_visible=lambda *_a, **_kw: None,
                )
            self.assertIn("refusing to overwrite", str(ctx.exception))

    def test_force_overwrites_existing_artifact(self) -> None:
        """Sanity-check the inverse: when ``force=True``, the
        orchestrator proceeds past the existence check."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            repo = tmp / "repo"
            repo.mkdir()
            _write_package_json(repo / "apps" / "vscode", version="4.1.10")
            output_dir = tmp / "out"
            output_dir.mkdir()
            dogfood_version = "4.1.10-2f3bdfeee"
            existing = output_dir / default_dogfood_vsix_name(
                "clinemm", dogfood_version
            )
            existing.write_bytes(b"\x00")

            attempted_worktree_add: list[list[str]] = []

            def fake_run(argv, cwd, **_kwargs):
                if argv[:2] == ["git", "status"]:
                    return ""
                if argv[:2] == ["git", "rev-parse"] and any(a.startswith("--short") for a in argv):
                    return "2f3bdfeee"
                if argv[:2] == ["git", "rev-parse"] and argv[-1] == "HEAD":
                    return "abcdef1234567890abcdef1234567890abcdef12"
                if (
                    argv[:2] == ["git", "rev-parse"]
                    and len(argv) == 3
                    and argv[2] != "HEAD"
                ):
                    return "abcdef1234567890abcdef1234567890abcdef12"
                if argv[:3] == ["git", "worktree", "remove"]:
                    shutil.rmtree(argv[4], ignore_errors=True)
                    return ""
                return ""

            raised: Optional[Exception] = None
            attempted_visible_worktree_add: list[list[str]] = []

            def fake_visible(argv, cwd):
                if argv[:3] == ["git", "worktree", "add"]:
                    attempted_visible_worktree_add.append(list(argv))
                    return

            try:
                build_dogfood_vsix(
                    repo=repo,
                    output_dir=output_dir,
                    force=True,
                    run_cmd=fake_run,
                    run_visible=fake_visible,
                )
            except BuildError as exc:
                raised = exc
            if raised is not None:
                self.assertNotIn("refusing to overwrite", str(raised))
            self.assertTrue(
                attempted_visible_worktree_add,
                msg="force=True must let the orchestrator proceed past the existence check",
            )


if __name__ == "__main__":
    unittest.main()