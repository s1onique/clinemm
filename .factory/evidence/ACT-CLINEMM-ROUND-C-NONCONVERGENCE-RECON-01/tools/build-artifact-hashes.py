#!/usr/bin/env python3
"""
ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01 — artifact identity binder.

Emits `artifact-hashes.json`: the source revision, the paths, byte sizes and
SHA-256 identities of every artifact this ACT produced, plus the private
evidence sources it was derived from.

The private source paths are recorded by absolute path and sha256 only. Their
CONTENTS are never copied into the evidence directory.

Usage:
    python3 build-artifact-hashes.py --repo-root <repo> --act-dir <dir> \
        --session-dir <private> --capture-dir <private> \
        --extension-dir <private> --out <act-dir>/artifact-hashes.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from typing import Any


def sha256_file(path: str) -> str | None:
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def entry(root: str, path: str, note: str | None = None) -> dict[str, Any]:
    abs_path = path if os.path.isabs(path) else os.path.join(root, path)
    record: dict[str, Any] = {
        "path": path if not os.path.isabs(path) else abs_path,
        "absolute_path": abs_path,
        "exists": os.path.exists(abs_path),
    }
    if record["exists"] and os.path.isfile(abs_path):
        record["bytes"] = os.path.getsize(abs_path)
        record["sha256"] = sha256_file(abs_path)
    if note:
        record["note"] = note
    return record


def git(root: str, *args: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "-C", root, *args],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    return out.stdout.strip()


def collect(act: str, subdir: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    directory = os.path.join(act, subdir) if subdir else act
    if not os.path.isdir(directory):
        return out
    for name in sorted(os.listdir(directory)):
        if name == "__pycache__" or name.endswith(".pyc"):
            continue
        path = os.path.join(directory, name)
        if os.path.isfile(path):
            relative = os.path.join(os.path.basename(act), subdir, name) if subdir else os.path.join(os.path.basename(act), name)
            out.append(
                {
                    "path": relative,
                    "bytes": os.path.getsize(path),
                    "sha256": sha256_file(path),
                }
            )
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--act-dir", required=True)
    parser.add_argument("--session-dir", required=True)
    parser.add_argument("--capture-dir", required=True)
    parser.add_argument("--extension-dir", required=True)
    parser.add_argument("--session-id", default="1795252560069_t82cp")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    repo = args.repo_root
    act = args.act_dir

    published: list[dict[str, Any]] = []
    published.extend(collect(act, ""))
    published.extend(collect(act, "tools"))
    published.extend(collect(act, "verification"))

    session_dir = args.session_dir
    private_sources = [
        entry(
            session_dir,
            os.path.join(session_dir, f"{args.session_id}.json"),
            "session manifest",
        ),
        entry(
            session_dir,
            os.path.join(session_dir, f"{args.session_id}.messages.json"),
            "session transcript (661 messages)",
        ),
        entry(
            session_dir,
            os.path.join(session_dir, f"{args.session_id}.compaction.json"),
            "compaction sidecar",
        ),
        entry(
            args.extension_dir,
            os.path.join(args.extension_dir, "dist", "extension.js"),
            "installed extension bundle that produced the session",
        ),
        entry(
            args.extension_dir,
            os.path.join(args.extension_dir, "build-provenance.json"),
            "installed extension build provenance",
        ),
    ]

    source = {
        "repo_root": repo,
        "entry_head": git(repo, "rev-parse", "HEAD"),
        "branch": git(repo, "rev-parse", "--abbrev-ref", "HEAD"),
        "entry_head_subject": git(repo, "log", "-1", "--format=%s"),
        "entry_head_date": git(repo, "log", "-1", "--format=%cI"),
        "working_tree_porcelain_lines": len(
            (git(repo, "status", "--porcelain") or "").splitlines()
        ),
        "installed_extension_dir": args.extension_dir,
        "installed_extension_version": os.path.basename(args.extension_dir),
    }

    inspected = [
        entry(repo, "sdk/packages/core/src/extensions/tools/definitions.ts"),
        entry(repo, "sdk/packages/core/src/extensions/tools/constants.ts"),
        entry(repo, "sdk/packages/core/src/extensions/tools/model-tool-routing.ts"),
        entry(repo, "sdk/packages/core/src/extensions/tools/presets.ts"),
        entry(repo, "sdk/packages/core/src/extensions/tools/definitions.test.ts"),
        entry(repo, "sdk/packages/core/src/extensions/context/task-contract.ts"),
        entry(repo, "sdk/packages/core/src/runtime/orchestration/runtime-builder.ts"),
        entry(repo, "sdk/packages/core/src/runtime/host/local-runtime-host.ts"),
        entry(repo, "sdk/packages/agents/src/agent-runtime.ts"),
        entry(repo, "sdk/packages/shared/src/agents/completion-reminder.ts"),
        entry(repo, "apps/vscode/src/sdk/cline-session-factory.ts"),
        entry(repo, "apps/vscode/src/sdk/vscode-session-host.ts"),
        entry(repo, "apps/vscode/src/sdk/background-notify-coordinator.ts"),
        entry(repo, "apps/vscode/src/sdk/command-status-tool.ts"),
        entry(repo, "apps/vscode/package.json"),
    ]

    doc = {
        "act_id": "ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01",
        "generated_by": "tools/build-artifact-hashes.py",
        "sanitization": (
            "Private evidence sources are referenced by absolute path and "
            "sha256 only. No raw transcript text, command text, file content "
            "or credential is copied into any published artifact."
        ),
        "source_identity": source,
        "published_artifacts": published,
        "private_evidence_sources": private_sources,
        "inspected_production_files": inspected,
    }

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(doc, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(f"wrote {args.out} ({len(published)} published artifacts)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
