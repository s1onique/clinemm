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
    compute_sha256,
    default_dogfood_vsix_name,
    derive_dogfood_version,
    read_package_version,
    remove_worktree_quietly,
    run_canonical_build,
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
# DOGFOOD06 — payload must include extension/dist/extension.js
# =============================================================================


class TestDogfood06PayloadExtensionJs(unittest.TestCase):
    """D09 / DOGFOOD06: missing ``extension/dist/extension.js`` is a
    build failure that must raise BuildError."""

    def test_present_passes(self) -> None:
        # Should not raise.
        verify_vsix_payload(
            {
                "extension/dist/extension.js",
                "extension/webview-ui/build/assets/index.js",
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
            }
        )

    def test_missing_webview_assets_fails(self) -> None:
        with self.assertRaises(BuildError) as ctx:
            verify_vsix_payload({"extension/dist/extension.js"})
        self.assertIn("webview-ui/build/assets", str(ctx.exception))


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