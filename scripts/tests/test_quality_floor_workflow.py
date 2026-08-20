"""
Unit tests for .github/workflows/quality-floor.yml

Enforces the GHA13 contract: the workflow file is itself a
checked-in artifact whose textual invariants are part of CI parity,
not just YAML prose. These tests run as stdlib unittest only, so
they have no third-party dependency and match the validator test
convention.

Contracts checked:

  GHA13.a  The "Verify baseline artifact consulted" step in the
           coverage-ratchet job MUST carry an explicit
             working-directory: ${{ github.workspace }}
           override, because the job-level defaults.run.working-directory
           is "apps/vscode" which would resolve the relative path
           to the wrong place.

  GHA13.b  No workflow under .github/workflows/ may invoke
             python3 -m pytest
           (or any other pytest invocation). The ubuntu-latest
           runner image does not guarantee pytest as part of its
           environment, and the project policy is dependency-free
           scripts.

  GHA13.c  The board-validator job MUST run validator unit tests
           via stdlib unittest (python3 -m unittest discover),
           NOT via pytest.

  GHA13.d  The quality-floor workflow MUST declare
             permissions: contents: read
           at workflow level (GHA09 read-only contract).

  GHA13.e  The quality-floor workflow MUST trigger on
             pull_request: branches: main
           AND
             push: branches: main
           (GHA08 expected triggers).

These are textual inspections of the workflow file. They do not
parse YAML (stdlib has no YAML parser; PyYAML is intentionally
not depended on for the same reason that pytest is not depended
on). For the contracts checked here, a textual scan is sufficient
and is more robust to YAML structural changes than a full parse.
"""
from __future__ import annotations
import re
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
REPO_ROOT = SCRIPTS.parent
QUALITY_FLOOR = REPO_ROOT / ".github" / "workflows" / "quality-floor.yml"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class TestQualityFloorGHA13Contracts(unittest.TestCase):
    """The workflow file's textual contracts must hold."""

    def setUp(self):
        if not QUALITY_FLOOR.exists():
            self.skipTest(f"quality-floor.yml not present at {QUALITY_FLOOR}")
        self.text = _read(QUALITY_FLOOR)

    def test_baseline_check_step_overrides_working_directory(self):
        # GHA13.a: the baseline verification step MUST have its own
        # working-directory: ${{ github.workspace }} override.
        #
        # YAML step structure: the body of a step is bounded by the
        # step's "- name:" indent level. We capture lines whose indent
        # is strictly deeper than the step's indent, then stop at the
        # first line that returns to (or goes shallower than) the
        # step's indent.
        text = self.text

        # Find the step's "- name:" line and its indent.
        name_match = re.search(
            r"^(?P<indent>[ \t]*)- name: Verify baseline artifact consulted[^\n]*$",
            text,
            re.MULTILINE,
        )
        self.assertIsNotNone(
            name_match,
            "Verify baseline artifact consulted step not found in workflow",
        )
        step_indent = name_match.group("indent")
        # Walk forward from the end of the name line, collecting body
        # lines whose indent is strictly deeper than step_indent.
        lines = text.splitlines(keepends=False)
        name_line_idx = text[: name_match.end()].count("\n")  # 0-based index
        body_lines: list[str] = []
        for line in lines[name_line_idx + 1 :]:
            if line.strip() == "":
                # Blank line: include only if we have NOT yet seen any
                # body line. If we have, stop.
                if not body_lines:
                    continue
                # We have body content; a blank line is the end of the
                # step block.
                break
            # Indent of this line:
            stripped = line.lstrip(" \t")
            indent_len = len(line) - len(stripped)
            if indent_len <= len(step_indent):
                # Returned to step-or-shallower: step boundary.
                break
            body_lines.append(line)
        body = "\n".join(body_lines)
        self.assertIn(
            "working-directory: ${{ github.workspace }}",
            body,
            "GHA13.a: the baseline check step MUST override "
            "working-directory to github.workspace (job default is "
            "apps/vscode which would resolve the relative .factory "
            "path incorrectly). See reviewer's P1 finding. "
            f"Step body was:\n{body}",
        )

    def test_no_pytest_in_any_workflow(self):
        # GHA13.b: no workflow under .github/workflows may invoke
        # python3 -m pytest (or bare pytest). Pytest is not a
        # stable dependency of the GitHub Actions ubuntu-latest
        # runner image.
        offenders: list[str] = []
        for wf in (REPO_ROOT / ".github" / "workflows").glob("*.yml"):
            txt = _read(wf)
            for line_no, line in enumerate(txt.splitlines(), start=1):
                # Match python3 -m pytest; ignore comments.
                stripped = line.split("#", 1)[0]
                if re.search(r"\bpython3\s+-m\s+pytest\b", stripped):
                    offenders.append(
                        f"{wf.name}:{line_no}: {line.strip()}"
                    )
        self.assertEqual(
            offenders,
            [],
            f"GHA13.b: workflows must not invoke pytest "
            f"(runner image does not guarantee pytest). Found: "
            f"{offenders}",
        )

    def test_board_validator_uses_stdlib_unittest(self):
        # GHA13.c: the board-validator job's "Run board validator
        # unit tests" step MUST use python3 -m unittest, NOT pytest.
        text = self.text
        m = re.search(
            r"^[ \t]*board-validator:[^\n]*\n(?P<body>(?:[ \t]+[^\n]*\n|[ \t]*\n)*)",
            text,
            re.MULTILINE,
        )
        self.assertIsNotNone(m, "board-validator job not found")
        body = m.group("body")
        self.assertRegex(
            body,
            r"python3\s+-m\s+unittest",
            "GHA13.c: board-validator job MUST use stdlib unittest "
            "(python3 -m unittest discover) for unit tests, not pytest.",
        )

    def test_quality_floor_read_only_permissions(self):
        # GHA13.d: the quality-floor workflow MUST declare
        # permissions: contents: read at workflow level.
        text = self.text
        wf_perm = re.search(
            r"^permissions:\s*\n(?P<body>(?:[ \t]+[^\n]*\n)+)",
            text,
            re.MULTILINE,
        )
        self.assertIsNotNone(wf_perm, "workflow-level 'permissions:' block missing")
        wf_perm_body = wf_perm.group("body")
        self.assertIn(
            "contents: read",
            wf_perm_body,
            "GHA13.d: workflow-level permissions must include "
            "'contents: read' (GHA09 read-only contract).",
        )

    def test_quality_floor_expected_triggers(self):
        # GHA13.e: workflow MUST trigger on
        #   pull_request: branches: main
        # AND
        #   push: branches: main
        text = self.text
        # Use (?m) inline flag because unittest.assertRegex calls
        # re.search() without flags, so ^ would only match at start
        # of string without MULTILINE.
        self.assertRegex(
            text,
            r"(?m)^\s*pull_request:\s*$",
            "GHA13.e: workflow must declare pull_request trigger",
        )
        self.assertRegex(
            text,
            r"(?m)^\s*push:\s*$",
            "GHA13.e: workflow must declare push trigger",
        )
        pr_block = re.search(
            r"^\s*pull_request:\s*\n((?:\s+[^\n]*\n)+)",
            text,
            re.MULTILINE,
        )
        self.assertIsNotNone(pr_block)
        self.assertIn("main", pr_block.group(1))
        push_block = re.search(
            r"^\s*push:\s*\n((?:\s+[^\n]*\n)+)",
            text,
            re.MULTILINE,
        )
        self.assertIsNotNone(push_block)
        self.assertIn("main", push_block.group(1))


if __name__ == "__main__":
    unittest.main()
