#!/usr/bin/env python3
"""
check-epic-board-markdown.py

Tiny, dependency-free validator for .factory/epic-board.md GitHub Flavored
Markdown rendering. Catches the regression class that produced this ACT:

  - Unbalanced / unmatched fenced code blocks
  - Canonical task index table header absent / malformed
  - Canonical task index table trapped inside a code fence
  - Table header missing a blank line before it
  - ATX heading inside an accidental open fence
  - Tab indentation (which GFM treats as a code-block trigger)
  - Unescaped pipes inside table cells (table-broken)

Run:
  python3 scripts/check-epic-board-markdown.py
  python3 scripts/check-epic-board-markdown.py path/to/file.md

Exits 0 if all checks pass; exits 1 otherwise.

This validator is intentionally small and dependency-free. It is NOT a
general-purpose Markdown parser; it only checks the structural rules that
matter for THIS file.
"""
from __future__ import annotations
import re
import sys
from pathlib import Path

DEFAULT_PATH = ".factory/epic-board.md"
CANONICAL_HEADER = "| ID | Area | Status | Priority | Depends on | Next action |"
CANONICAL_HEADER_RE = re.compile(
    r"^\|\s*ID\s*\|\s*Area\s*\|\s*Status\s*\|\s*Priority\s*\|\s*Depends on\s*\|\s*Next action\s*\|\s*$"
)
FENCE_RE = re.compile(r"^\s*```\s*$")


def fence_balance(lines):
    """Return list of (line_no, kind, depth_before, depth_after) events for fence toggles."""
    events = []
    depth = 0
    for i, ln in enumerate(lines, start=1):
        if FENCE_RE.match(ln):
            before = depth
            depth = 1 - depth
            kind = "OPEN" if depth == 1 else "CLOSE"
            events.append((i, kind, before, depth))
    return events, depth


def check(path: Path) -> int:
    if not path.exists():
        print(f"ERROR: file not found: {path}", file=sys.stderr)
        return 1

    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()

    failures: list[str] = []
    warnings: list[str] = []

    # 1) Fence balance
    events, final_depth = fence_balance(lines)
    if final_depth != 0:
        opens = [e for e in events if e[1] == "OPEN"]
        # The most-recent unclosed opener is the suspect
        suspect = opens[-1][0] if opens else None
        failures.append(
            f"fences are unbalanced (final depth={final_depth}); "
            f"the most-recent unmatched opener is at L{suspect}"
        )

    # 2) Canonical task index header exists
    header_idx = None
    for i, ln in enumerate(lines, start=1):
        if CANONICAL_HEADER_RE.match(ln):
            header_idx = i
            break
    if header_idx is None:
        failures.append(f"canonical task index header not found: {CANONICAL_HEADER!r}")
    else:
        # 3) Header is NOT inside a code fence
        depth = 0
        for i, ln in enumerate(lines, start=1):
            if FENCE_RE.match(ln):
                depth = 1 - depth
            if i == header_idx:
                if depth > 0:
                    failures.append(
                        f"canonical task index header at L{i} is inside a code fence"
                    )
                break

        # 4) Blank line immediately before the header
        if header_idx >= 2 and lines[header_idx - 2].strip() != "":
            failures.append(
                f"canonical task index header at L{header_idx} is missing a blank line before it"
            )

    # 5) No ATX heading inside an open fence
    depth = 0
    for i, ln in enumerate(lines, start=1):
        if FENCE_RE.match(ln):
            depth = 1 - depth
            continue
        if depth > 0 and re.match(r"^#{1,6} ", ln):
            failures.append(
                f"ATX heading inside code fence at L{i}: {ln.strip()[:80]!r}"
            )

    # 6) Tab indentation
    for i, ln in enumerate(lines, start=1):
        if "\t" in ln:
            failures.append(f"tab character at L{i} (GFM treats tab as code-block trigger)")

    # 7) Table-broken: rows where the cell-pipe count exceeds the header's pipe count
    # Find the canonical task index table
    if header_idx is not None:
        header_line = lines[header_idx - 1]
        expected_pipes = header_line.count("|")  # includes leading + trailing + N-1 separators
        # Walk forward through table rows
        for i in range(header_idx, len(lines)):
            ln = lines[i].rstrip()
            if not ln.lstrip().startswith("|"):
                break
            if not ln.endswith("|"):
                # table row that doesn't end with | is malformed
                failures.append(
                    f"table row at L{i + 1} does not end with | (row will break the table)"
                )
                continue
            # Count pipes; flag rows with more pipes than the header (unescaped pipe inside cell).
            # Strip markdown-escaped pipes (\|) before counting: a \| still occupies one raw
            # character but is a legitimate pipe inside a table cell, not a table break.
            pipe_count = re.sub(r"\\\|", "", ln).count("|")
            if pipe_count > expected_pipes:
                # Try to identify the offending cell content
                failures.append(
                    f"table row at L{i + 1} has {pipe_count} pipes (expected <= {expected_pipes}); "
                    f"likely an unescaped pipe inside a cell"
                )

    # Print results
    if warnings:
        for w in warnings:
            print(f"WARN: {w}")

    if failures:
        print(f"FAIL: {path} has {len(failures)} markdown rendering issue(s):", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1

    print(f"OK: {path} ({len(lines)} lines, {len(events)} fence events)")
    return 0


def main(argv):
    if len(argv) > 1:
        path = Path(argv[1])
    else:
        path = Path(DEFAULT_PATH)
    return check(path)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
