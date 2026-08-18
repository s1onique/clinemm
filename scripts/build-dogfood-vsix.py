#!/usr/bin/env python3
"""ACT-CLINEMM-REPRODUCIBLE-DOGFOOD-VSIX01 — thin CLI entrypoint.

Builds a SHA-stamped dogfood VSIX deterministically from a clean
canonical HEAD. Composes the testable library in
``build_dogfood_vsix_lib``; all orchestration logic lives there so
that D01..D12 can be unit-tested without Bun / VSCE side-effects.

Usage:
    python3 scripts/build-dogfood-vsix.py               # build only
    python3 scripts/build-dogfood-vsix.py --install     # + install into dogfood profile
    python3 scripts/build-dogfood-vsix.py --force       # overwrite existing artifact

Output: a JSON object on stdout describing the build (source head,
dogfood version, artifact path, sha256, bytes, optional install
state). Exit codes:
    0 = success
    2 = build error (clean tree violated, packaging failed, etc.)

See ``scripts/tests/test_build_dogfood_vsix.py`` for the DOGFOOD01..10
invariant tests.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Make the sibling-library import robust whether this CLI is invoked
# from the repo root (``python3 scripts/build-dogfood-vsix.py``) or
# via ``PYTHONPATH`` (``python3 -m ...``).
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from build_dogfood_vsix_lib import (  # noqa: E402  (path setup above)
    BuildError,
    build_dogfood_vsix,
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", default=".", help="path inside the canonical monorepo")
    ap.add_argument("--output-dir", default="dist/dogfood", help="where to drop the VSIX")
    ap.add_argument("--install", action="store_true", help="install via the dogfood CLI")
    ap.add_argument(
        "--install-cli",
        default="codium-cline",
        help="CLI used for --install (must be on PATH when --install is set)",
    )
    ap.add_argument(
        "--ns-name",
        default="s1onique.clinemm",
        help="publisher.name the install verifier expects after --install",
    )
    ap.add_argument("--force", action="store_true", help="overwrite an existing artifact")
    ap.add_argument(
        "--skip-typecheck",
        action="store_true",
        help=(
            "deliberate dogfood shortcut: bypass the full-project "
            "tsc --noEmit gate and use the protos+build:webview+esbuild "
            "--production path instead. NOT for release."
        ),
    )
    args = ap.parse_args()

    try:
        result = build_dogfood_vsix(
            repo=Path(args.repo).resolve(),
            output_dir=Path(args.output_dir).resolve(),
            install=args.install,
            install_cli=args.install_cli,
            extension_ns_name=args.ns_name,
            force=args.force,
            skip_typecheck=args.skip_typecheck,
        )
    except BuildError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
