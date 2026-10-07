#!/usr/bin/env python3
"""ACT-CLINEMM-ELMIZE-P1-TOOLCHAIN-RESOLVER01 resolver contract tests.

The Elm compiler is a toolchain input, NOT source. Every kernel
build-elm.sh sources scripts/elm_toolchain.sh and pins 0.19.2.
The orchestrator resolves the compiler on the build host via
:func:resolve_elm_compiler and passes it in via $ELM_BIN.

This test file covers BOTH layers:
  * Shell: the resolver precedence + fail-closed branches.
  * Python: the orchestrator-side resolve_elm_compiler and the new
    build_elm_kernel ELM_BIN env-pass-through contract.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_LIB_DIR = _HERE.parent
sys.path.insert(0, str(_LIB_DIR))

from build_dogfood_vsix_lib import (  # noqa: E402
    BuildError,
    _ELM_REQUIRED_VERSION,
    build_elm_kernel,
    compute_sha256,
    resolve_elm_compiler,
)


def _make_fake_elm(target: Path, version: str) -> Path:
    """Materialise a minimal stand-in for the Elm compiler that
    prints ``version`` when invoked with ``--version`` and exits 0.
    The script is pure /bin/bash — no python3 dependency — so it
    survives the test's stripped PATH (the resolver contract is
    tested with PATH pointing at an empty / scratch dir so the
    resolver cannot fall back to the host's real Python)."""
    target.write_text(textwrap.dedent(f"""\
        #!/bin/bash
        if [ "$1" = "--version" ]; then
            echo "{version}"
        fi
        exit 0
    """))
    target.chmod(0o755)
    return target


class TestShellResolverPrecedence(unittest.TestCase):
    """Pin the 4-branch precedence contract of scripts/elm_toolchain.sh:
      1. ${ELM_BIN} wins if set + executable.
      2. ${HERE}/vendor/elm wins if HERE is set + file is executable.
      3. system elm on PATH wins only if exactly 0.19.2.
      4. Fail closed with HALT_ELM_TOOLCHAIN_UNRESOLVED.
    """

    SHELL_RESOLVER = (
        Path(__file__).resolve().parent.parent / "elm_toolchain.sh"
    )

    def _sourced_resolver(self, env):
        # Capture the resolver's exit code BEFORE the printf, because
        # `printf` always returns 0 and would mask the source's rc.
        # We use `local rc=$?` immediately after the source line so
        # rc holds the resolver's real exit code; the function then
        # returns rc instead of the printf's rc.
        cmd = textwrap.dedent(f"""\
            _run() {{
                local rc=0
                source "{self.SHELL_RESOLVER}"
                rc=$?
                printf "ELM=[%s]\\nVERSION=[%s]\\nSHA=[%s]\\n" \\
                    "${{ELM}}" "${{ELM_VERSION}}" "${{ELM_BIN_SHA256}}"
                return $rc
            }}
            _run
        """)
        proc = subprocess.run(
            ["/bin/bash", "-c", cmd],
            env=env,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=10,
        )
        return proc.returncode, proc.stdout, proc.stderr

    def test_branch1_elm_bin_override_wins(self):
        with tempfile.TemporaryDirectory() as td:
            fake = Path(td) / "elm-fake"
            _make_fake_elm(fake, "0.19.2")
            env = os.environ.copy()
            env["ELM_BIN"] = str(fake)
            env["HERE"] = "/nonexistent"
            rc, out, err = self._sourced_resolver(env)
            self.assertEqual(rc, 0, msg=f"stderr={err}")
            self.assertIn(f"ELM=[{fake}]", out)
            self.assertIn("VERSION=[0.19.2]", out)

    def test_branch2_repo_local_vendor_fallback(self):
        with tempfile.TemporaryDirectory() as td:
            here = Path(td) / "elm-kernel"
            vendor = here / "vendor"
            vendor.mkdir(parents=True)
            _make_fake_elm(vendor / "elm", "0.19.2")
            env = os.environ.copy()
            env.pop("ELM_BIN", None)
            env["HERE"] = str(here)
            rc, out, err = self._sourced_resolver(env)
            self.assertEqual(rc, 0, msg=f"stderr={err}")
            self.assertIn(f"ELM=[{vendor / 'elm'}]", out)
            self.assertIn("VERSION=[0.19.2]", out)

    def test_branch3_system_elm_only_if_0_19_2(self):
        with tempfile.TemporaryDirectory() as td:
            _make_fake_elm(Path(td) / "elm", "0.19.1")
            env = os.environ.copy()
            env.pop("ELM_BIN", None)
            env.pop("HERE", None)
            env["PATH"] = td
            rc, out, err = self._sourced_resolver(env)
            self.assertNotEqual(rc, 0)
            self.assertIn("HALT_ELM_TOOLCHAIN_VERSION_MISMATCH", err)
            self.assertIn("0.19.1", err)

    def test_branch4_fail_closed_when_no_elm_anywhere(self):
        with tempfile.TemporaryDirectory() as td:
            env = os.environ.copy()
            env.pop("ELM_BIN", None)
            env.pop("HERE", None)
            env["PATH"] = td
            rc, out, err = self._sourced_resolver(env)
            self.assertNotEqual(rc, 0)
            self.assertIn("HALT_ELM_TOOLCHAIN_UNRESOLVED", err)
            self.assertIn("Remediation", err)

    def test_explicit_elm_bin_to_wrong_version_halts(self):
        with tempfile.TemporaryDirectory() as td:
            fake_wrong = Path(td) / "elm"
            _make_fake_elm(fake_wrong, "0.19.1")
            env = os.environ.copy()
            env["ELM_BIN"] = str(fake_wrong)
            rc, out, err = self._sourced_resolver(env)
            self.assertNotEqual(rc, 0)
            self.assertIn("HALT_ELM_TOOLCHAIN_VERSION_MISMATCH", err)

    def test_resolver_pins_exact_version(self):
        self.assertEqual(_ELM_REQUIRED_VERSION, "0.19.2")


class TestPythonResolver(unittest.TestCase):
    """Pin the orchestrator-side resolve_elm_compiler contract."""

    def test_explicit_path_branch(self):
        with tempfile.TemporaryDirectory() as td:
            fake = Path(td) / "elm"
            _make_fake_elm(fake, "0.19.2")
            res = resolve_elm_compiler(explicit_path=fake)
            self.assertEqual(res["path"], fake)
            self.assertEqual(res["version"], "0.19.2")
            self.assertEqual(res["reason"], "ELM_BIN override")
            self.assertEqual(len(res["sha256"]), 64)
            self.assertTrue(
                all(c in "0123456789abcdef" for c in res["sha256"])
            )

    def test_wrong_version_explicit_path_halts(self):
        with tempfile.TemporaryDirectory() as td:
            fake_wrong = Path(td) / "elm"
            _make_fake_elm(fake_wrong, "0.19.1")
            with self.assertRaises(BuildError) as ctx:
                resolve_elm_compiler(explicit_path=fake_wrong)
            # Authoritative override: a wrong-version override halts
            # closed with the dedicated VERSION_MISMATCH code, NOT
            # silently falls through to a different compiler.
            self.assertIn(
                "HALT_ELM_TOOLCHAIN_VERSION_MISMATCH", str(ctx.exception)
            )
            self.assertIn("0.19.1", str(ctx.exception))
            self.assertIn("refuses to substitute", str(ctx.exception))

    def test_no_elm_anywhere_halts(self):
        import build_dogfood_vsix_lib as lib_mod
        saved_candidates = lib_mod._ELM_BREW_CANDIDATES
        saved_path = os.environ.get("PATH")
        try:
            lib_mod._ELM_BREW_CANDIDATES = ()
            with tempfile.TemporaryDirectory() as td:
                os.environ["PATH"] = td
                with self.assertRaises(BuildError) as ctx:
                    resolve_elm_compiler()
            self.assertIn("HALT_ELM_TOOLCHAIN_UNRESOLVED", str(ctx.exception))
        finally:
            lib_mod._ELM_BREW_CANDIDATES = saved_candidates
            if saved_path is not None:
                os.environ["PATH"] = saved_path

    def test_only_wrong_version_system_elm_halts(self):
        import build_dogfood_vsix_lib as lib_mod
        saved_candidates = lib_mod._ELM_BREW_CANDIDATES
        saved_path = os.environ.get("PATH")
        try:
            lib_mod._ELM_BREW_CANDIDATES = ()
            with tempfile.TemporaryDirectory() as td:
                _make_fake_elm(Path(td) / "elm", "0.19.1")
                os.environ["PATH"] = td
                with self.assertRaises(BuildError) as ctx:
                    resolve_elm_compiler()
            self.assertIn("HALT_ELM_TOOLCHAIN_UNRESOLVED", str(ctx.exception))
            self.assertIn("0.19.1", str(ctx.exception))
        finally:
            lib_mod._ELM_BREW_CANDIDATES = saved_candidates
            if saved_path is not None:
                os.environ["PATH"] = saved_path

    def test_homebrew_slot_preferred_over_path_when_both_present(self):
        import build_dogfood_vsix_lib as lib_mod
        saved = lib_mod._ELM_BREW_CANDIDATES
        try:
            with tempfile.TemporaryDirectory() as td:
                _make_fake_elm(Path(td) / "elm", "0.19.1")
                homebrew = Path(td) / "homebrew"
                homebrew.mkdir()
                good = homebrew / "elm"
                _make_fake_elm(good, "0.19.2")
                lib_mod._ELM_BREW_CANDIDATES = (str(good),)

                saved_path = os.environ.get("PATH")
                os.environ["PATH"] = td
                try:
                    res = resolve_elm_compiler()
                finally:
                    if saved_path is not None:
                        os.environ["PATH"] = saved_path
                self.assertEqual(res["path"], good)
                self.assertEqual(res["version"], "0.19.2")
                self.assertIn("homebrew slot", res["reason"])
        finally:
            lib_mod._ELM_BREW_CANDIDATES = saved


class TestBuildElmKernelEnvPassThrough(unittest.TestCase):
    """Pin the new build_elm_kernel contract: the returned compiler
    dict is what the orchestrator stamps into the artifact metadata.
    The env pass-through lives behind the production default runner;
    tests can exercise the recorder seam and still verify the dict."""

    def test_returns_compiler_dict(self):
        with tempfile.TemporaryDirectory() as td:
            stage = Path(td)
            apps = stage / "apps" / "vscode"
            scripts = apps / "elm" / "test-kernel" / "scripts"
            scripts.mkdir(parents=True)
            (scripts / "build-elm.sh").write_text(
                "#!/usr/bin/env bash\nexit 0\n"
            )
            (scripts / "build-elm.sh").chmod(0o755)

            with tempfile.TemporaryDirectory() as ctd:
                fake_compiler = Path(ctd) / "elm"
                _make_fake_elm(fake_compiler, "0.19.2")
                compiler = {
                    "path": fake_compiler,
                    "version": "0.19.2",
                    "sha256": compute_sha256(fake_compiler),
                    "reason": "test seam",
                }
                rec = []

                def record(argv, cwd):
                    rec.append((list(argv), Path(cwd)))

                import build_dogfood_vsix_lib as lib_mod
                saved_kernels = lib_mod._ELM_KERNELS
                lib_mod._ELM_KERNELS = [
                    {
                        "name": "test-kernel",
                        "build_script": "apps/vscode/elm/test-kernel/scripts/build-elm.sh",
                        "source_js": "elm/test-kernel/vendor/test-kernel.js",
                        "source_sha": "elm/test-kernel/vendor/test-kernel.js.sha256",
                        "staged_dir": "runtime-assets",
                        "staged_name": "test-kernel.js",
                        "staged_sha_name": "test-kernel.js.sha256",
                        "vsix_entry": "extension/runtime-assets/test-kernel.js",
                        "vsix_sha_entry": "extension/runtime-assets/test-kernel.js.sha256",
                    }
                ]
                try:
                    ret = build_elm_kernel(
                        apps, run_visible=record, elm_compiler=compiler
                    )
                finally:
                    lib_mod._ELM_KERNELS = saved_kernels

                self.assertEqual(len(rec), 1)
                self.assertEqual(ret, compiler)


class TestCompilerHashContract(unittest.TestCase):
    def test_sha256_is_64_lowercase_hex(self):
        with tempfile.TemporaryDirectory() as td:
            fake = Path(td) / "elm"
            _make_fake_elm(fake, "0.19.2")
            sha = compute_sha256(fake)
            self.assertEqual(len(sha), 64)
            self.assertTrue(
                all(c in "0123456789abcdef" for c in sha)
            )


if __name__ == "__main__":
    unittest.main()
