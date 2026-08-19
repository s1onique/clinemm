"""
Unit tests for scripts/check-code-coverage-ratchet.py

Uses stdlib unittest, matching the project's testing conventions
(see scripts/tests/test_check_epic_board_markdown.py and
 scripts/tests/test_dump_cline_issues.py).

The tests exercise the verifier with synthetic fixtures (no real
coverage data). They prove that:

  A. the verifier PASSES on an exact baseline match
  B. the verifier FAILS on each of the four count regressions
  C. the verifier FAILS on a coverage-percentage increase that
     conceals a covered-count decrease (e.g. via denominator
     reduction)
  D. the verifier FAILS when the source-universe shrinks
  E. the verifier FAILS when a new product file is missing
     from the report
  F. the verifier FAILS when the source-universe legitimately
     shrank (deleted file) WITHOUT a baseline update
  G. the verifier FAILS on a malformed baseline
  H. the verifier FAILS on a malformed report
  I. the verifier FAILS when coverage-ignore directives increase
  J. the verifier FAILS when the coverage scope contract
     (include/exclude) changes

These tests are deterministic and offline (no network, no subprocess
of the actual coverage runner; the verifier itself is the unit under
test, exercised via direct in-process invocation).
"""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
_spec = importlib.util.spec_from_file_location(
    "check_code_coverage_ratchet",
    str(SCRIPTS / "check-code-coverage-ratchet.py"),
)
verifier = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(verifier)  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

BASELINE_COVERED = {
    "statements": 6980,
    "branches": 4202,
    "functions": 1311,
    "lines": 6832,
}

BASELINE_TOTALS = {
    "statements": {"total": 43994, "covered": 6980, "pct": 15.86},
    "branches": {"total": 38071, "covered": 4202, "pct": 11.03},
    "functions": {"total": 6943, "covered": 1311, "pct": 18.88},
    "lines": {"total": 43228, "covered": 6832, "pct": 15.80},
}

BASELINE_PER_FILE_PATHS = [
    "apps/vscode/src/common.ts",
    "apps/vscode/src/config.ts",
    "apps/vscode/src/extension.ts",
    "apps/vscode/src/sdk/foo.ts",
    "apps/vscode/src/sdk/bar.ts",
    "apps/vscode/src/sdk/baz.ts",
    "apps/vscode/src/utils/util.ts",
]


def make_baseline(
    *,
    covered: dict[str, int] | None = None,
    totals: dict[str, int] | None = None,
    per_file: list[str] | None = None,
    config_fingerprint: str | None = None,
) -> dict:
    """Build a baseline artifact matching the schema_v1 contract."""
    cov = covered if covered is not None else dict(BASELINE_COVERED)
    tot = totals if totals is not None else {m: {"total": t["total"], "covered": cov[m], "pct": round(cov[m] / t["total"] * 100, 2)} for m, t in BASELINE_TOTALS.items()}
    files = per_file if per_file is not None else list(BASELINE_PER_FILE_PATHS)
    scope: dict = {
        "root": "apps/vscode",
        "production_file_count": len(files),
    }
    if config_fingerprint is not None:
        scope["config_fingerprint"] = config_fingerprint
    return {
        "schema_version": 1,
        "baseline_name": "VITEST_COVERAGE_BASELINE",
        "subject_head": "deadbeef00000000000000000000000000000000",
        "subject_tree": "cafebabe00000000000000000000000000000000",
        "vitest_version": "vitest/4.1.10 darwin-arm64",
        "provider": "v8",
        "config": "apps/vscode/vitest.config.ts",
        "command": "cd apps/vscode && bunx vitest run --config vitest.config.ts --coverage",
        "scope": scope,
        "totals": tot,
        "bands": {
            "zero": 0, "lt25": 0, "lt50": 0, "lt75": 0, "lt90": 0, "gte90": len(files),
        },
        "per_file": [{"path": p} for p in files],
    }


def make_report(
    *,
    covered: dict[str, int] | None = None,
    totals: dict[str, int] | None = None,
    per_file: list[str] | None = None,
    repo_root: Path | None = None,
) -> dict:
    """Build a coverage-summary.json-like dict with repo-root-prefixed per-file paths.

    If `repo_root` is provided, paths are prefixed with `str(repo_root) + "/"`
    to match what the actual coverage tool emits. Tests that need a controlled
    prefix should set repo_root; the default uses a placeholder prefix that
    won't match the verifier's root, which is the canonical case for "scope
    regression" tests."""
    cov = covered if covered is not None else dict(BASELINE_COVERED)
    tot = totals if totals is not None else {m: {"total": t["total"], "covered": cov[m], "pct": round(cov[m] / t["total"] * 100, 2)} for m, t in BASELINE_TOTALS.items()}
    files = per_file if per_file is not None else list(BASELINE_PER_FILE_PATHS)
    out: dict = {"total": tot}
    prefix = (str(repo_root).rstrip("/") + "/") if repo_root is not None else "/repo/"
    for p in files:
        # Synthetic coverage entry for each file
        out[f"{prefix}{p}"] = {
            "lines": {"pct": 50, "total": 100, "covered": 50},
            "statements": {"pct": 50, "total": 100, "covered": 50},
            "functions": {"pct": 50, "total": 5, "covered": 3},
            "branches": {"pct": 50, "total": 10, "covered": 5},
        }
    return out


def make_source_tree(paths: list[str], root: Path) -> None:
    """Create empty source files at the given repo-relative paths."""
    for p in paths:
        full = root / p
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text("// stub\n", encoding="utf-8")


def make_vitest_config(root: Path, *, coverage_block: str | None = None) -> None:
    """Create a minimal apps/vscode/vitest.config.ts with the given coverage block.

    The verifier parses the textual coverage block; providing a stable block makes
    tests reproducible. If coverage_block is None, the coverage block is omitted.
    """
    cfg_path = root / "apps/vscode/vitest.config.ts"
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    block = coverage_block if coverage_block is not None else "coverage: { provider: 'v8', include: ['src/**'] }"
    cfg_path.write_text(f"// stub\ndefineConfig({{ test: {{ {block} }} }});\n", encoding="utf-8")


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh)


# ---------------------------------------------------------------------------
# Test base
# ---------------------------------------------------------------------------


class _VerifierHarness:
    """Run the verifier end-to-end against a synthesized root tree and return the exit code.

    The setUp() in each test class is responsible for creating the
    source tree (so tests can mutate files after setUp but before the
    harness runs). The harness only writes the baseline, summary, and
    vitest.config artifacts.
    """

    def __init__(self, root: Path, baseline: dict, report: dict, *,
                 baseline_ignore: int | None = None,
                 coverage_block: str | None = None) -> None:
        self.root = root
        self.baseline_ignore = baseline_ignore
        baseline_path = root / "baseline.json"
        summary_path = root / "summary.json"
        write_json(baseline_path, baseline)
        write_json(summary_path, report)
        # Note: do NOT call make_source_tree here. setUp() creates the
        # source tree so that tests can mutate individual files (e.g.
        # to add an ignore directive) before invoking the verifier.
        # Always point the verifier at the temp-dir vitest.config.ts so
        # it does not accidentally read the host repo's config.
        if coverage_block is not None:
            make_vitest_config(root, coverage_block=coverage_block)
        else:
            # No coverage block: create the file with no block so the
            # verifier exercises the missing-contract path.
            cfg_path = root / "apps/vscode/vitest.config.ts"
            cfg_path.parent.mkdir(parents=True, exist_ok=True)
            cfg_path.write_text("// stub\ndefineConfig({ test: {} });\n", encoding="utf-8")
        self.baseline_path = baseline_path
        self.summary_path = summary_path
        self.vitest_config_path = root / "apps/vscode/vitest.config.ts"

    def run(self) -> int:
        argv = [
            "check-code-coverage-ratchet.py",
            "--baseline", str(self.baseline_path),
            "--summary", str(self.summary_path),
            "--root", str(self.root),
            "--vitest-config", str(self.vitest_config_path),
        ]
        if getattr(self, "baseline_ignore", None) is not None:
            argv.extend(["--baseline-ignore-directive-count", str(self.baseline_ignore)])
        old_argv = sys.argv
        sys.argv = argv
        try:
            return verifier.main()
        finally:
            sys.argv = old_argv


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class AExactBaselinePasses(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        # Make the source files exist
        make_source_tree(list(BASELINE_PER_FILE_PATHS), self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_exact_baseline_match_passes(self) -> None:
        baseline = make_baseline()
        report = make_report(repo_root=self.root.resolve())  # covered counts == baseline
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_OK)


class BCoverageRegressionsFail(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_source_tree(list(BASELINE_PER_FILE_PATHS), self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_lines_decrease_fails(self) -> None:
        baseline = make_baseline()
        covered = dict(BASELINE_COVERED)
        covered["lines"] = BASELINE_COVERED["lines"] - 1
        report = make_report(covered=covered, repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_COUNT_REGRESSION)

    def test_statements_decrease_fails(self) -> None:
        baseline = make_baseline()
        covered = dict(BASELINE_COVERED)
        covered["statements"] = BASELINE_COVERED["statements"] - 1
        report = make_report(covered=covered, repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_COUNT_REGRESSION)

    def test_functions_decrease_fails(self) -> None:
        baseline = make_baseline()
        covered = dict(BASELINE_COVERED)
        covered["functions"] = BASELINE_COVERED["functions"] - 1
        report = make_report(covered=covered, repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_COUNT_REGRESSION)

    def test_branches_decrease_fails(self) -> None:
        baseline = make_baseline()
        covered = dict(BASELINE_COVERED)
        covered["branches"] = BASELINE_COVERED["branches"] - 1
        report = make_report(covered=covered, repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_COUNT_REGRESSION)


class CPercentHidesCountDecrease(unittest.TestCase):
    """A naive percentage threshold (lines_pct >= 15.80) would PASS this
    scenario, but the count-based ratchet must FAIL it.

    Setup:
      baseline lines total=43228, covered=6832, pct=15.80
      current  lines total=10000, covered=2000, pct=20.00 (percentage UP)
                but covered count dropped from 6832 to 2000.

    A pure percentage ratchet accepts this; a count ratchet must reject.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_source_tree(list(BASELINE_PER_FILE_PATHS), self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_pct_up_but_count_down_fails(self) -> None:
        baseline = make_baseline()
        # Re-shape totals: current has smaller total but smaller covered too,
        # so percentage goes up.
        new_totals = {m: dict(v) for m, v in BASELINE_TOTALS.items()}
        new_totals["lines"] = {"total": 10000, "covered": 2000, "pct": 20.00}
        new_totals["statements"] = {"total": 5000, "covered": 1000, "pct": 20.00}
        new_totals["branches"] = {"total": 4000, "covered": 800, "pct": 20.00}
        new_totals["functions"] = {"total": 500, "covered": 200, "pct": 40.00}
        # All covered counts strictly LESS than baseline.
        report = make_report(
            covered={
                "statements": 1000,
                "branches": 800,
                "functions": 200,
                "lines": 2000,
            },
            totals=new_totals,
            repo_root=self.root.resolve(),
        )
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_COUNT_REGRESSION)


class DScopeUniverseShrinkFails(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_source_tree(list(BASELINE_PER_FILE_PATHS), self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_baseline_file_missing_from_current_report_fails(self) -> None:
        """A baseline file is present in the source tree but the report
        excludes it. This would be a silent scope shrink; the ratchet
        must fail."""
        baseline = make_baseline()
        # Synthesize a report that only reports 2 of the 3 baseline files.
        report = make_report(per_file=BASELINE_PER_FILE_PATHS[:3], repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_SCOPE_REGRESSION)


class ENewProductFileMissingFromReportFails(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_source_tree(list(BASELINE_PER_FILE_PATHS), self.root)
        # Add a NEW product file not in baseline
        make_source_tree(["apps/vscode/src/sdk/new-file.ts"], self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_new_file_absent_from_report_fails(self) -> None:
        baseline = make_baseline()
        # Report still only has the original 3 files; the new one is missing.
        report = make_report(per_file=BASELINE_PER_FILE_PATHS, repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_SCOPE_REGRESSION)


class FLegitimateFileDeletionFails(unittest.TestCase):
    """If a baseline file is genuinely deleted from the source tree, the
    current_files set will not contain it AND the report won't include it
    either (since the report was generated from the current source tree).
    The verifier must FAIL the ratchet (forcing the baseline to be
    rebaselined), NOT silently lower the baseline."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        # Source tree contains only some of the baseline files
        make_source_tree(BASELINE_PER_FILE_PATHS[:5], self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_baseline_file_missing_from_source_tree_fails(self) -> None:
        baseline = make_baseline()
        # Source tree only has 5 of 7 baseline files; report (which mirrors
        # current source state) only has 5 too. The 2 deleted baseline
        # files are absent from both source tree and report. This is the
        # canonical deletion-without-rebaseline case.
        report = make_report(per_file=BASELINE_PER_FILE_PATHS[:5], repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_SCOPE_REGRESSION)


class GMalformedBaselineFails(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_source_tree(list(BASELINE_PER_FILE_PATHS), self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_baseline_missing_required_field_fails(self) -> None:
        baseline = make_baseline()
        del baseline["totals"]["lines"]  # remove required field
        report = make_report(repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_BASELINE_INVALID)

    def test_baseline_wrong_provider_fails(self) -> None:
        baseline = make_baseline()
        baseline["provider"] = "istanbul"  # wrong
        report = make_report(repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_BASELINE_INVALID)

    def test_baseline_wrong_root_fails(self) -> None:
        baseline = make_baseline()
        baseline["scope"]["root"] = "apps/other"
        report = make_report(repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_BASELINE_INVALID)


class HMalformedReportFails(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_source_tree(list(BASELINE_PER_FILE_PATHS), self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_report_missing_total_fails(self) -> None:
        baseline = make_baseline()
        report = {}  # no 'total'
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_REPORT_INVALID)

    def test_report_with_no_per_file_entries_fails(self) -> None:
        baseline = make_baseline()
        report = {"total": BASELINE_TOTALS}  # only 'total', no per-file
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_REPORT_INVALID)


class IIgnoreDirectiveIncreaseFails(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_source_tree(list(BASELINE_PER_FILE_PATHS), self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_new_ignore_directive_fails(self) -> None:
        baseline = make_baseline()
        # No ignore directives yet in baseline
        report = make_report(repo_root=self.root.resolve())
        # Add an istanbul ignore directive to one source file
        (self.root / "apps/vscode/src/sdk/foo.ts").write_text(
            "// istanbul ignore next\nfunction f() { return 1; }\n", encoding="utf-8"
        )
        h = _VerifierHarness(self.root, baseline, report,
                              baseline_ignore=0,
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_IGNORE_DIRECTIVE_REGRESSION)

    def test_existing_ignore_directives_preserved_passes(self) -> None:
        baseline = make_baseline()
        report = make_report(repo_root=self.root.resolve())
        # Add ONE ignore directive
        (self.root / "apps/vscode/src/sdk/foo.ts").write_text(
            "// istanbul ignore next\nfunction f() { return 1; }\n", encoding="utf-8"
        )
        h = _VerifierHarness(self.root, baseline, report,
                              baseline_ignore=1,  # baseline already has 1
                              coverage_block="coverage: { provider: 'v8', include: ['src/**'] }")
        self.assertEqual(h.run(), verifier.EXIT_OK)


class JScopeConfigChangedFails(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        make_source_tree(list(BASELINE_PER_FILE_PATHS), self.root)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_scope_config_fingerprint_mismatch_fails(self) -> None:
        # Compute the SHA of the current coverage block
        current_block = "coverage: { provider: 'v8', include: ['src/**'] }"
        from hashlib import sha256
        current_fp = sha256(current_block.encode("utf-8")).hexdigest()
        # Baseline claims a different fingerprint
        baseline = make_baseline(config_fingerprint="0" * 64)
        report = make_report(repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block=current_block)
        self.assertEqual(h.run(), verifier.EXIT_SCOPE_CONFIG_CHANGED)

    def test_scope_config_fingerprint_match_passes(self) -> None:
        # Compute the SHA of the current coverage block
        current_block = "coverage: { provider: 'v8', include: ['src/**'] }"
        from hashlib import sha256
        current_fp = sha256(current_block.encode("utf-8")).hexdigest()
        baseline = make_baseline(config_fingerprint=current_fp)
        report = make_report(repo_root=self.root.resolve())
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block=current_block)
        self.assertEqual(h.run(), verifier.EXIT_OK)

    def test_no_coverage_block_fails(self) -> None:
        baseline = make_baseline()
        report = make_report(repo_root=self.root.resolve())
        # coverage_block=None causes the harness to write a vitest.config.ts
        # with no coverage block. The verifier must detect this.
        h = _VerifierHarness(self.root, baseline, report,
                              coverage_block=None)
        self.assertEqual(h.run(), verifier.EXIT_SCOPE_CONFIG_CHANGED)


class KTestFixturesCoveredInPlans(unittest.TestCase):
    """Sanity check that test fixture design matches the plan's enumeration."""

    def test_all_plan_letters_have_a_test(self) -> None:
        # A, B, C, D, E, F, G, H, I, J are mapped in this file
        # This is a meta-check to ensure we have at least one test per letter
        # and that no letter was silently dropped.
        # Note: the verifier does not have a "test L changed provider" or
        # "test M new ignore directive" beyond what's already in I and J.
        plan_letters = "ABCDEFGHIJK"
        cls = unittest.TestLoader().loadTestsFromModule(sys.modules[__name__])
        # Each class name starts with a letter prefix matching the plan.
        class_prefixes = sorted({c.__class__.__name__[:1] for c in (a for s in cls for a in s)})
        missing = sorted(set(plan_letters) - set(class_prefixes))
        self.assertEqual(missing, [], f"missing test letter(s) for plan: {missing}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
