"""
Unit tests for scripts/check-epic-board-markdown.py

Uses stdlib unittest, matching the project's testing conventions
(see scripts/tests/test_dump_cline_issues.py).

These tests are deliberately small and self-contained.
"""
from __future__ import annotations
import os
import sys
import unittest
import tempfile
from pathlib import Path

# Make the validator importable via direct path
HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent
import importlib.util

_spec = importlib.util.spec_from_file_location(
    "check_epic_board_markdown",
    str(SCRIPTS / "check-epic-board-markdown.py"),
)
validator = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(validator)  # noqa: E402


CANONICAL_HEADER = (
    "| ID | Area | Status | Priority | Depends on | Next action |\n"
    "|---|---|---|---|---|---|\n"
)


def _write(content: str) -> Path:
    """Write content to a temp file and return the path."""
    fd, name = tempfile.mkstemp(suffix=".md", prefix="board-")
    os.close(fd)
    Path(name).write_text(content, encoding="utf-8")
    return Path(name)


# Minimal valid board content used for sanity tests
MINIMAL_VALID = (
    "# Cline-- Global Epic Board\n"
    "\n"
    "## Repository topology\n"
    "\n"
    "```\n"
    "REPOSITORY TOPOLOGY\n"
    "\n"
    "  canonical repository:    /tmp/example\n"
    "  canonical branch:        main\n"
    "```\n"
    "\n"
    "---\n"
    "\n"
    "## Canonical task index\n"
    "\n"
    + CANONICAL_HEADER +
    "| `TASK-01` | AREA | OPEN | HIGH | none | action item |\n"
)


class TestFenceBalance(unittest.TestCase):
    def test_balanced_fences_pass(self):
        p = _write(MINIMAL_VALID)
        try:
            self.assertEqual(validator.check(p), 0)
        finally:
            p.unlink()

    def test_unbalanced_fence_fails(self):
        # Add an extra opener with no closer
        bad = MINIMAL_VALID + "\n```\n"
        p = _write(bad)
        try:
            self.assertEqual(validator.check(p), 1)
        finally:
            p.unlink()

    def test_extra_closer_fails(self):
        # Add an extra closer (no opener to balance)
        bad = MINIMAL_VALID + "```\n"
        p = _write(bad)
        try:
            self.assertEqual(validator.check(p), 1)
        finally:
            p.unlink()

    def test_three_nested_pairs_balance(self):
        text = (
            "```\n"
            "block 1\n"
            "```\n"
            "\n"
            "```\n"
            "block 2\n"
            "```\n"
            "\n"
            "```\n"
            "block 3\n"
            "```\n"
            "\n"
            "## Canonical task index\n"
            "\n"
            + CANONICAL_HEADER +
            "| `T1` | A | OPEN | HIGH | none | action |\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 0)
        finally:
            p.unlink()


class TestCanonicalIndex(unittest.TestCase):
    def test_canonical_header_absent_fails(self):
        # No canonical header in the file
        text = "# Title\n\nno header here\n"
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 1)
        finally:
            p.unlink()

    def test_canonical_header_inside_fence_fails(self):
        text = (
            "# Title\n\n"
            "```\n"
            + CANONICAL_HEADER +
            "| `TASK-01` | AREA | OPEN | HIGH | none | action |\n"
            "```\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 1)
        finally:
            p.unlink()

    def test_canonical_header_missing_blank_line_fails(self):
        text = (
            "# Title\n\n"
            "---\n"
            "## Canonical task index\n"
            + CANONICAL_HEADER +  # no blank line before
            "| `TASK-01` | AREA | OPEN | HIGH | none | action |\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 1)
        finally:
            p.unlink()

    def test_canonical_header_with_blank_line_passes(self):
        text = (
            "# Title\n\n"
            "---\n\n"
            "## Canonical task index\n\n"
            + CANONICAL_HEADER +
            "| `TASK-01` | AREA | OPEN | HIGH | none | action |\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 0)
        finally:
            p.unlink()


class TestTableIntegrity(unittest.TestCase):
    def test_unescaped_pipe_in_cell_fails(self):
        # Header has 6 cells (5 separators + 2 boundary pipes = 7 pipes)
        text = (
            "# Title\n\n"
            "## Canonical task index\n\n"
            + CANONICAL_HEADER +
            "| `T1` | A | OPEN | HIGH | none | icon `|| → --`; note |\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 1)
        finally:
            p.unlink()

    def test_escaped_unicode_pipe_in_cell_passes(self):
        text = (
            "# Title\n\n"
            "## Canonical task index\n\n"
            + CANONICAL_HEADER +
            "| `T1` | A | OPEN | HIGH | none | icon `‖ → --`; note |\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 0)
        finally:
            p.unlink()

    def test_row_missing_trailing_pipe_fails(self):
        text = (
            "# Title\n\n"
            "## Canonical task index\n\n"
            + CANONICAL_HEADER +
            "| `T1` | A | OPEN | HIGH | none | action\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 1)
        finally:
            p.unlink()


class TestHeadingInsideFence(unittest.TestCase):
    def test_heading_inside_fence_fails(self):
        text = (
            "# Title\n\n"
            "## Section\n\n"
            "```\n"
            "## Heading inside fence\n"
            "```\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 1)
        finally:
            p.unlink()

    def test_heading_outside_fence_passes(self):
        text = (
            "# Title\n\n"
            "## Section\n\n"
            "```\n"
            "literal block\n"
            "```\n"
            "\n"
            "## Heading after fence\n\n"
            + CANONICAL_HEADER +
            "| `T1` | A | OPEN | HIGH | none | action |\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 0)
        finally:
            p.unlink()


class TestTabIndentation(unittest.TestCase):
    def test_tab_in_line_fails(self):
        text = "# Title\n\n\tindented with tab\n"
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 1)
        finally:
            p.unlink()

    def test_spaces_only_passes(self):
        text = (
            "# Title\n\n    spaces only\n\n"
            "## Canonical task index\n\n"
            + CANONICAL_HEADER +
            "| `T1` | A | OPEN | HIGH | none | action |\n"
        )
        p = _write(text)
        try:
            self.assertEqual(validator.check(p), 0)
        finally:
            p.unlink()


class TestRealBoard(unittest.TestCase):
    """The actual board file must pass."""

    def test_real_board_passes(self):
        repo_root = SCRIPTS.parent
        path = repo_root / ".factory" / "epic-board.md"
        if not path.exists():
            self.skipTest(f"real board not present at {path}")
        self.assertEqual(validator.check(path), 0)


if __name__ == "__main__":
    unittest.main()
