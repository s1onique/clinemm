#!/usr/bin/env python3
"""
check-code-coverage-ratchet.py

Artifact-backed code-coverage non-regression verifier for Cline--'s
canonical Vitest gate.

The ratchet enforces:

  - the four covered counts (statements / branches / functions / lines)
    from the qualified baseline must NOT decrease
  - the source-universe identity (exact per-file paths) is preserved
    modulo legitimate source-tree changes
  - the current coverage report is well-formed and includes every
    currently intended production file
  - the coverage-ignore directive count does not increase silently
  - the coverage scope contract (include / exclude) is unchanged

It does NOT enforce:

  - arbitrary percentage thresholds
  - test-writing campaigns
  - multi-runner aggregation

Run:

  python3 scripts/check-code-coverage-ratchet.py \\
      --baseline .factory/quality/code-coverage-baseline.json \\
      --summary apps/vscode/coverage/coverage-summary.json \\
      --final apps/vscode/coverage/coverage-final.json \\
      --root apps/vscode

Exit codes:

  0  PASS
  2  baseline artifact is invalid
  3  current coverage report is invalid
  4  covered count regression (any of statements/branches/functions/lines)
  5  source-universe regression (baseline file missing, or new product
     file absent from current report)
  6  coverage-ignore directive increased
  7  coverage scope contract (include/exclude) changed
  8  malformed input (could not read files)
  9  internal error
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


EXIT_OK = 0
EXIT_BASELINE_INVALID = 2
EXIT_REPORT_INVALID = 3
EXIT_COUNT_REGRESSION = 4
EXIT_SCOPE_REGRESSION = 5
EXIT_IGNORE_DIRECTIVE_REGRESSION = 6
EXIT_SCOPE_CONFIG_CHANGED = 7
EXIT_MALFORMED_INPUT = 8
EXIT_INTERNAL_ERROR = 9


# Coverage-ignore directive patterns we inventory.
# Mirrors what the runner's coverage provider (v8 / Istanbul) actually honors.
IGNORE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"/\*\s*istanbul\s+ignore\s+", re.IGNORECASE),
    re.compile(r"//\s*istanbul\s+ignore\s+", re.IGNORECASE),
    re.compile(r"/\*\s*c8\s+ignore\s+", re.IGNORECASE),
    re.compile(r"//\s*c8\s+ignore\s+", re.IGNORECASE),
    re.compile(r"/\*\s*v8\s+ignore\s+", re.IGNORECASE),
    re.compile(r"//\s*v8\s+ignore\s+", re.IGNORECASE),
    re.compile(r"/\*\s*coverage\s+disable", re.IGNORECASE),
    re.compile(r"//\s*coverage\s+disable", re.IGNORECASE),
)


def load_json(path: Path) -> dict[str, Any]:
    """Read a JSON file or raise SystemExit(8)."""
    try:
        with path.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        print(f"FAIL: file not found: {path}", file=sys.stderr)
        sys.exit(EXIT_MALFORMED_INPUT)
    except json.JSONDecodeError as exc:
        print(f"FAIL: invalid JSON in {path}: {exc}", file=sys.stderr)
        sys.exit(EXIT_MALFORMED_INPUT)


def validate_baseline(baseline: dict[str, Any]) -> list[str]:
    """Return a list of human-readable errors (empty = OK)."""
    errs: list[str] = []
    if baseline.get("schema_version") != 1:
        errs.append(f"baseline.schema_version must be 1, got {baseline.get('schema_version')!r}")
    if baseline.get("provider") != "v8":
        errs.append(f"baseline.provider must be 'v8', got {baseline.get('provider')!r}")
    scope = baseline.get("scope") or {}
    if scope.get("root") != "apps/vscode":
        errs.append(f"baseline.scope.root must be 'apps/vscode', got {scope.get('root')!r}")
    if scope.get("production_file_count") is None:
        errs.append("baseline.scope.production_file_count is required")
    totals = baseline.get("totals") or {}
    for metric in ("statements", "branches", "functions", "lines"):
        m = totals.get(metric) or {}
        if "total" not in m or "covered" not in m or "pct" not in m:
            errs.append(f"baseline.totals.{metric} must contain total/covered/pct")
    per_file = baseline.get("per_file")
    if not per_file:
        errs.append("baseline.per_file must contain at least the canonical file list")
    else:
        for entry in per_file:
            if "path" not in entry:
                errs.append("baseline.per_file entries must contain 'path'")
                break
    return errs


def validate_report(summary: dict[str, Any]) -> list[str]:
    """Return a list of human-readable errors (empty = OK)."""
    errs: list[str] = []
    if "total" not in summary:
        errs.append("coverage-summary.json missing 'total'")
    total = summary.get("total") or {}
    for metric in ("statements", "branches", "functions", "lines"):
        m = total.get(metric) or {}
        if "total" not in m or "covered" not in m or "pct" not in m:
            errs.append(f"summary.total.{metric} must contain total/covered/pct")
    return errs


def expected_covered_floors(baseline: dict[str, Any]) -> dict[str, int]:
    totals = baseline.get("totals") or {}
    return {
        metric: int(totals[metric]["covered"]) for metric in ("statements", "branches", "functions", "lines")
    }


def covered_now(summary: dict[str, Any]) -> dict[str, int]:
    total = summary.get("total") or {}
    return {
        metric: int(total[metric]["covered"]) for metric in ("statements", "branches", "functions", "lines")
    }


def baseline_source_files(baseline: dict[str, Any]) -> set[str]:
    """Canonical production file paths from the baseline (relative to repo root)."""
    return set(entry["path"] for entry in baseline.get("per_file", []))


def report_source_files(summary: dict[str, Any], repo_root: str) -> set[str]:
    """Per-file paths from the current coverage report, normalized to repo-relative paths."""
    rel_paths: set[str] = set()
    prefix = repo_root.rstrip("/") + "/"
    for k in summary.keys():
        if k == "total":
            continue
        if k.startswith(prefix):
            rel_paths.add(k[len(prefix):])
        else:
            rel_paths.add(k)
    return rel_paths


def current_product_source_files(repo_root: Path, root_relative: str) -> set[str]:
    """Independently compute the production source set under apps/vscode/src, applying the canonical include/exclude contract.

    This is the contract the coverage config embodies (see apps/vscode/vitest.config.ts:coverage):
      include: src/**/*.{ts,tsx}
      exclude: **/__tests__/**, **/*.test.*, **/*.spec.*, src/test/**, src/generated/**, src/packages/**
    """
    src_root = repo_root / root_relative / "src"
    if not src_root.is_dir():
        return set()
    out: set[str] = set()
    for p in src_root.rglob("*.ts"):
        rel = (p.relative_to(repo_root)).as_posix()
        out.add(rel)
    for p in src_root.rglob("*.tsx"):
        rel = (p.relative_to(repo_root)).as_posix()
        out.add(rel)
    # Apply exclude contract
    exclude_fns = (
        lambda rel: "/__tests__/" in rel,
        lambda rel: rel.endswith(".test.ts") or rel.endswith(".test.tsx"),
        lambda rel: rel.endswith(".spec.ts") or rel.endswith(".spec.tsx"),
        lambda rel: rel.startswith(f"{root_relative}/src/test/"),
        lambda rel: rel.startswith(f"{root_relative}/src/generated/"),
        lambda rel: rel.startswith(f"{root_relative}/src/packages/"),
    )
    out = {r for r in out if not any(f(r) for f in exclude_fns)}
    return out


def coverage_ignore_directive_count(repo_root: Path, source_files: set[str]) -> int:
    """Count occurrences of coverage-ignore directives across all currently intended source files."""
    total = 0
    for rel in source_files:
        path = repo_root / rel
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for pat in IGNORE_PATTERNS:
            total += len(pat.findall(text))
    return total


def extract_scope_contract(vitest_config_text: str) -> dict[str, Any] | None:
    """Best-effort extraction of the coverage block from vitest.config.ts.

    The goal is to detect *change* of the include/exclude arrays.
    We do not need a full TS parser; matching the textual block is enough
    because the ratchet compares fingerprints across runs.
    """
    # Find the coverage block (between `coverage: {` and its matching `}`).
    start = vitest_config_text.find("coverage:")
    if start == -1:
        return None
    i = vitest_config_text.find("{", start)
    if i == -1:
        return None
    depth = 0
    end = -1
    for j in range(i, len(vitest_config_text)):
        ch = vitest_config_text[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = j
                break
    if end == -1:
        return None
    block = vitest_config_text[start:end + 1]
    return {
        "block": block,
        "block_sha256": hashlib.sha256(block.encode("utf-8")).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Artifact-backed Vitest coverage non-regression verifier.",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        default=Path(".factory/quality/code-coverage-baseline.json"),
        help="Qualified baseline artifact path",
    )
    parser.add_argument(
        "--summary",
        type=Path,
        default=Path("apps/vscode/coverage/coverage-summary.json"),
        help="Current coverage-summary.json path",
    )
    parser.add_argument(
        "--final",
        type=Path,
        default=Path("apps/vscode/coverage/coverage-final.json"),
        help="Current coverage-final.json path (reserved; not used in v1 verifier)",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=Path("."),
        help="Repository root",
    )
    parser.add_argument(
        "--vitest-config",
        type=Path,
        default=Path("apps/vscode/vitest.config.ts"),
        help="Path to apps/vscode/vitest.config.ts",
    )
    parser.add_argument(
        "--baseline-ignore-directive-count",
        type=int,
        default=None,
        help=(
            "Override the baseline ignore-directive count. When the baseline artifact "
            "predates ignore-directive tracking, the verifier treats the current count "
            "as the floor."
        ),
    )
    args = parser.parse_args()

    repo_root = args.root.resolve()

    # 1. Load and validate baseline
    baseline = load_json(args.baseline)
    errs = validate_baseline(baseline)
    if errs:
        print("FAIL: baseline artifact invalid:", file=sys.stderr)
        for e in errs:
            print(f"  - {e}", file=sys.stderr)
        return EXIT_BASELINE_INVALID

    # 2. Load and validate current report
    summary = load_json(args.summary)
    errs = validate_report(summary)
    if errs:
        print("FAIL: current coverage report invalid:", file=sys.stderr)
        for e in errs:
            print(f"  - {e}", file=sys.stderr)
        return EXIT_REPORT_INVALID

    if len(summary) < 2:  # 1 'total' + at least 1 file
        print(f"FAIL: coverage-summary.json has no per-file entries ({len(summary) - 1})", file=sys.stderr)
        return EXIT_REPORT_INVALID

    # 3. Floor check: covered counts
    floors = expected_covered_floors(baseline)
    now = covered_now(summary)
    deltas = {m: now[m] - floors[m] for m in floors}
    regressed = [m for m, d in deltas.items() if d < 0]
    if regressed:
        print("FAIL: covered-count regression", file=sys.stderr)
        for m in regressed:
            print(
                f"  - {m}: baseline covered={floors[m]}, current covered={now[m]}, delta={deltas[m]}",
                file=sys.stderr,
            )
        return EXIT_COUNT_REGRESSION

    # 4. Source-universe integrity
    baseline_files = baseline_source_files(baseline)
    root_relative = (baseline.get("scope") or {}).get("root", "apps/vscode")
    current_files = current_product_source_files(repo_root, root_relative)
    report_files = report_source_files(summary, str(repo_root))

    missing_from_source: list[str] = []
    missing_from_report: list[str] = []
    for bf in baseline_files:
        if bf not in current_files and bf not in report_files:
            missing_from_source.append(bf)
        elif bf in current_files and bf not in report_files:
            missing_from_report.append(bf)

    new_files_missing_from_report: list[str] = []
    for cf in current_files:
        if cf not in report_files and cf not in baseline_files:
            new_files_missing_from_report.append(cf)

    if missing_from_source or missing_from_report or new_files_missing_from_report:
        print("FAIL: source-universe regression", file=sys.stderr)
        if missing_from_source:
            print(
                f"  - {len(missing_from_source)} baseline file(s) missing from both source tree and current report:",
                file=sys.stderr,
            )
            for p in missing_from_source[:10]:
                print(f"      - {p}", file=sys.stderr)
            if len(missing_from_source) > 10:
                print(f"      ... and {len(missing_from_source) - 10} more", file=sys.stderr)
        if missing_from_report:
            print(
                f"  - {len(missing_from_report)} baseline file(s) exist in source tree but absent from current report:",
                file=sys.stderr,
            )
            for p in missing_from_report[:10]:
                print(f"      - {p}", file=sys.stderr)
            if len(missing_from_report) > 10:
                print(f"      ... and {len(missing_from_report) - 10} more", file=sys.stderr)
        if new_files_missing_from_report:
            print(
                f"  - {len(new_files_missing_from_report)} new product file(s) absent from current report:",
                file=sys.stderr,
            )
            for p in new_files_missing_from_report[:10]:
                print(f"      - {p}", file=sys.stderr)
            if len(new_files_missing_from_report) > 10:
                print(f"      ... and {len(new_files_missing_from_report) - 10} more", file=sys.stderr)
        return EXIT_SCOPE_REGRESSION

    # 5. Coverage-ignore directive count
    if args.baseline_ignore_directive_count is not None:
        baseline_ignore_count = int(args.baseline_ignore_directive_count)
    else:
        baseline_ignore_count = 0

    current_ignore_count = coverage_ignore_directive_count(repo_root, current_files)
    if current_ignore_count > baseline_ignore_count:
        print("FAIL: coverage-ignore directive regression", file=sys.stderr)
        print(
            f"  - baseline ignore-directive count: {baseline_ignore_count}, current: {current_ignore_count}",
            file=sys.stderr,
        )
        return EXIT_IGNORE_DIRECTIVE_REGRESSION

    # 6. Coverage scope contract (include/exclude) — change detection
    config_fingerprint: str | None = None
    if args.vitest_config.is_file():
        try:
            config_text = args.vitest_config.read_text(encoding="utf-8", errors="replace")
        except OSError:
            config_text = ""
        contract = extract_scope_contract(config_text)
        if contract is None:
            print("FAIL: coverage scope contract missing in vitest.config.ts", file=sys.stderr)
            return EXIT_SCOPE_CONFIG_CHANGED
        config_fingerprint = contract["block_sha256"]
        baseline_fingerprint = (baseline.get("scope") or {}).get("config_fingerprint")
        if baseline_fingerprint and baseline_fingerprint != config_fingerprint:
            print("FAIL: coverage scope contract changed", file=sys.stderr)
            print(f"  - baseline config_fingerprint: {baseline_fingerprint}", file=sys.stderr)
            print(f"  - current  config_fingerprint: {config_fingerprint}", file=sys.stderr)
            return EXIT_SCOPE_CONFIG_CHANGED

    # 7. PASS
    print("PASS: coverage ratchet holds")
    print(f"  scope_file_count={len(current_files)}  report_file_count={len(report_files)}")
    for m in ("statements", "branches", "functions", "lines"):
        print(f"  {m}: baseline_covered={floors[m]} current_covered={now[m]} delta={deltas[m]}")
    print(f"  ignore_directive_count: baseline={baseline_ignore_count} current={current_ignore_count}")
    if config_fingerprint:
        print(f"  coverage_config_fingerprint={config_fingerprint}")
    return EXIT_OK


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"INTERNAL ERROR: {exc}", file=sys.stderr)
        sys.exit(EXIT_INTERNAL_ERROR)
