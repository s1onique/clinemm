#!/usr/bin/env python3
"""
Persist a read-only ClineMM approval specimen.

This tool:
- does not approve/reject tools;
- does not modify Cline state;
- does not copy API keys or global settings wholesale;
- captures repository identity, recent session metadata, and approval
  diagnostic events into a content-hashed evidence directory.

Python: 3.10+

ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01
=========================================================
This revision is a bounded forensic correction. The pre-correction
collector (`snapshot --phase {pending|resolved}`) had four defects:

  P0.1  `--phase resolved` without `--capture-id` silently minted a
        new ID; the filesystem did not bind `resolved` to `pending`.
        FIX: split into `begin` / `finish` / `report` subcommands;
        `finish` requires `--capture-id` and a pre-existing `pending/`
        directory; refuses otherwise.

  P0.2  Both phases reported the same approval event count with no
        event-delta computation; the human's specific action was not
        machine-identifiable.
        FIX: at `begin`, freeze an event-fingerprint file; at `finish`,
        compute `*-before.jsonl` / `*-after.jsonl` / `*-delta.jsonl`
        and write `approval-discriminator.json` with the discriminators
        the upstream policy-vs-control-flow distinction depends on.

  P0.3  `SESSION_CANDIDATES=0` was indistinguishable from a successful
        capture, so a forensic verdict was unreachable.
        FIX: separate `artifactStatus` (PASS — the file was generated)
        from `specimenBinding` (PASS | CAPTURE_INSUFFICIENT). The exit
        code stays 0 for artifact generation; the binding verdict is a
        separate machine-readable field.

  P1    The pre-correction collector identified sessions by a hard-coded
        filename allowlist (`session.json` / `messages.json`), which
        missed the real session storage layout. Both test captures
        showed `sessionCandidateCount: 0`.
        FIX: shape-based session scan — match files whose decoded JSON
        contains the field shape `{id|sessionId|taskId, status, provider,
        model, mode, source, timestamps}` rather than the filename.

The two captures from 2026-08-27 are preserved verbatim under
`.factory/evidence/ACT-CLINEMM-EDITOR-TOOL-APPROVAL-FRICTION-RECON01/
captures/{20260827T211256Z-9171c6f6,20260827T211338Z-435b5360}/` and
their relationship is recorded in `specimen-20260827-command-approval01.json`
under the same directory. They are valid hard copies of a human-observed
chronology even though their filesystem identity is not bound — see the
binding record for the explicit `CAPTURE_INSUFFICIENT` verdict.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable


APPROVAL_MARKERS = (
    "approval.entry.v2",
    "approval.terminal.v2",
)

# Session identity vocabulary observed in real ClineMM storage
# (2026-08-27 inspection of `.cline2/data/sessions/.../*.json`
# revealed snake_case `session_id`) AND in synthetic fixtures
# (2026-08-28 hermetic fixture uses both `session_id` AND
# `sessionId` AND `taskId` to exercise every alias).
# Update by adding aliases that have been observed in actual storage;
# do NOT widen heuristically.
SESSION_ID_KEYS = (
    "id",
    "sessionId",
    "session_id",
    "taskId",
    "task_id",
)

# Field shape that identifies a session/task record regardless of
# filename. The presence of at least one SESSION_ID_KEYS AND
# `status` is the load-bearing minimum; `provider`, `model`, `mode`,
# `source`, and a timestamp pair enrich the projection.
SESSION_SHAPE_KEYS = (
    "id",
    "sessionId",
    "session_id",
    "taskId",
    "task_id",
    "status",
    "provider",
    "model",
    "mode",
    "source",
    "created_at",
    "updated_at",
    "started_at",
    "ended_at",
)

# Files whose names strongly suggest session content but for which
# we still MUST apply the shape scan; never trust the filename alone.
SESSION_FILENAME_HINTS = {
    "session.json",
    "messages.json",
    "task.json",
    "task_state.json",
    "task-state.json",
    "conversation_history.json",
    "state.json",
}

# Never copy these wholesale.
SENSITIVE_NAME_PARTS = (
    "globalstate",
    "settings",
    "secret",
    "credential",
    "apikey",
    "api-key",
    "token",
)

MAX_SCAN_FILE_BYTES = 64 * 1024 * 1024
DEFAULT_RECENT_MINUTES = 180

# Stable schema versions — bumped on breaking changes.
BINDING_SCHEMA = "cline-approval-specimen-binding/v1"
CAPTURE_SCHEMA = "cline-approval-specimen-capture/v2"
DISCRIMINATOR_SCHEMA = "cline-approval-discriminator/v1"
REPORT_SCHEMA = "cline-approval-specimen-report/v1"


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def capture_id() -> str:
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{stamp}-{secrets.token_hex(4)}"


def run(cmd: list[str], cwd: Path | None = None) -> tuple[int, str, str]:
    p = subprocess.run(
        cmd,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    return p.returncode, p.stdout, p.stderr


def git(repo: Path, *args: str) -> str | None:
    rc, out, _ = run(["git", *args], cwd=repo)
    return out.strip() if rc == 0 else None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def dump_json(path: Path, obj: Any) -> None:
    path.write_text(
        json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )


def is_sensitive_path(path: Path) -> bool:
    name = path.name.lower()
    return any(part in name for part in SENSITIVE_NAME_PARTS)


def recent(path: Path, minutes: int) -> bool:
    cutoff = dt.datetime.now().timestamp() - minutes * 60
    try:
        return path.stat().st_mtime >= cutoff
    except OSError:
        return False


def candidate_data_roots(explicit: list[str]) -> list[Path]:
    if explicit:
        return [Path(x).expanduser().resolve() for x in explicit]

    home = Path.home()
    found: list[Path] = []

    for p in home.glob(".cline*"):
        if p.is_dir():
            found.append(p.resolve())

    return sorted(set(found))


def iter_bounded_files(root: Path, minutes: int) -> Iterable[Path]:
    try:
        iterator = root.rglob("*")
    except OSError:
        return

    for path in iterator:
        try:
            if not path.is_file():
                continue
            if is_sensitive_path(path):
                continue
            st = path.stat()
            if st.st_size > MAX_SCAN_FILE_BYTES:
                continue
            if not recent(path, minutes):
                continue
            yield path
        except OSError:
            continue


def extract_approval_lines(path: Path) -> list[str]:
    matches: list[str] = []

    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if any(marker in line for marker in APPROVAL_MARKERS):
                    matches.append(line.rstrip("\n"))
    except (OSError, UnicodeError):
        pass

    return matches


SAFE_SESSION_KEYS = {
    "id",
    "sessionId",
    "session_id",
    "taskId",
    "task_id",
    "status",
    "source",
    "interactive",
    "mode",
    "provider",
    "model",
    "created_at",
    "updated_at",
    "started_at",
    "ended_at",
    "exit_code",
    "enable_tools",
    "enable_spawn",
    "enable_teams",
}


def safe_session_projection(obj: Any) -> Any:
    if not isinstance(obj, dict):
        return {"_capture": "JSON_OBJECT_EXPECTED"}

    result = {}
    for key in SAFE_SESSION_KEYS:
        if key in obj:
            result[key] = obj[key]
    return result


def looks_like_session_record(obj: Any) -> bool:
    """Shape check for session/task records.

    The pre-correction collector relied on a filename allowlist, which
    missed every persisted ClineMM session under the test data roots.
    This shape check matches files whose decoded JSON is plausibly a
    session/task record regardless of filename.

    Identity vocabulary (observed in real ClineMM storage 2026-08-27 +
    in synthetic fixture 2026-08-28):
        { id, sessionId, session_id, taskId, task_id }

    Load-bearing minimum: at least one identity key AND `status`. The
    remaining SESSION_SHAPE_KEYS enrich the projection when present.
    Lists are scanned element-wise.
    """
    if isinstance(obj, dict):
        has_id = any(k in obj for k in SESSION_ID_KEYS)
        return has_id and "status" in obj
    if isinstance(obj, list):
        return any(looks_like_session_record(item) for item in obj)
    return False


def collect_session_metadata(
    roots: list[Path],
    out_dir: Path,
    minutes: int,
) -> list[dict[str, Any]]:
    target = out_dir / "session-metadata"
    target.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []

    for root in roots:
        for path in iter_bounded_files(root, minutes):
            # Shape-first, filename-second. Filename hints reduce false
            # positives on dense log files but are never load-bearing.
            try:
                obj = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                # Only record parse errors for filename-hinted files;
                # silently skipping dense log files avoids millions of
                # irrelevant parse-error records.
                if path.name in SESSION_FILENAME_HINTS:
                    records.append(
                        {
                            "source": str(path),
                            "root": str(root),
                            "shapeMatched": False,
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                    )
                continue

            if not looks_like_session_record(obj):
                continue

            # Do not persist messages.json bodies wholesale.
            if path.name == "messages.json":
                if isinstance(obj, list):
                    projection = {
                        "_capture": "MESSAGE_BODY_OMITTED",
                        "message_count": len(obj),
                        "matchedByShape": True,
                    }
                elif isinstance(obj, dict):
                    projection = {
                        "_capture": "MESSAGE_BODY_OMITTED",
                        "top_level_keys": sorted(obj.keys()),
                        "matchedByShape": True,
                    }
                else:
                    projection = {
                        "_capture": "MESSAGE_BODY_OMITTED",
                        "type": type(obj).__name__,
                        "matchedByShape": True,
                    }
            elif isinstance(obj, list):
                # Wrap the list — preserve metadata about length without
                # copying every message.
                projection = {
                    "_capture": "LIST_PROXIED",
                    "length": len(obj),
                    "head_keys": sorted(obj[0].keys())
                    if obj and isinstance(obj[0], dict)
                    else None,
                    "matchedByShape": True,
                }
            else:
                projection = safe_session_projection(obj)
                projection["matchedByShape"] = True

            item = {
                "source": str(path),
                "root": str(root),
                "mtime": dt.datetime.fromtimestamp(
                    path.stat().st_mtime, tz=dt.timezone.utc
                ).isoformat(),
                "shapeMatched": True,
                "projection": projection,
            }
            records.append(item)

    dump_json(target / "index.json", records)
    return records


def normalize_event(line: str, source: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "source": source,
        "raw": line,
    }

    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        result["parsed"] = False
        return result

    result["parsed"] = True

    # Preserve exact structured record but strip common content-heavy fields.
    def scrub(value: Any) -> Any:
        if isinstance(value, dict):
            cleaned = {}
            for k, v in value.items():
                kl = k.lower()

                if any(
                    token in kl
                    for token in (
                        "apikey",
                        "api_key",
                        "authorization",
                        "credential",
                        "prompt",
                        "responsebody",
                        "response_body",
                        "toolinput",
                        "tool_input",
                    )
                ):
                    cleaned[k] = "<REDACTED_BY_CAPTURE_TOOL>"
                else:
                    cleaned[k] = scrub(v)
            return cleaned

        if isinstance(value, list):
            return [scrub(v) for v in value]

        return value

    result["event"] = scrub(obj)
    return result


def collect_approval_events(
    roots: list[Path],
    out_dir: Path,
    minutes: int,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []

    for root in roots:
        for path in iter_bounded_files(root, minutes):
            for line in extract_approval_lines(path):
                events.append(normalize_event(line, str(path)))

    event_path = out_dir / "approval-events.jsonl"
    with event_path.open("w", encoding="utf-8") as fh:
        for event in events:
            fh.write(json.dumps(event, sort_keys=True, ensure_ascii=False))
            fh.write("\n")

    return events


def event_fingerprint(event: dict[str, Any]) -> str:
    """Stable per-event fingerprint for delta computation.

    CONTENT-ONLY by design: the fingerprint is a sha256 of the
    canonical parsed event (or the raw line, if unparseable). The
    source path is intentionally NOT folded in, so a logically
    identical event reappearing under a different file path
    (e.g. before/diagnostics/before.jsonl vs.
    after/diagnostics/after.jsonl in a hermetic fixture) produces
    the same fingerprint and is therefore correctly classified as
    "already known."

    A genuinely new event has different content and a different
    fingerprint; an event that was merely re-logged under a new
    path is treated as already known.
    """
    raw = event.get("raw") or ""
    if not raw:
        obj = event.get("event") or {}
        canonical = json.dumps(obj, sort_keys=True, ensure_ascii=False)
    else:
        canonical = raw
    h = hashlib.sha256()
    h.update(canonical.encode("utf-8"))
    return h.hexdigest()


def write_event_fingerprints(
    out_dir: Path, events: list[dict[str, Any]]
) -> None:
    fingerprints = [
        {
            "fingerprint": event_fingerprint(event),
            "source": event.get("source"),
            "parsed": bool(event.get("parsed")),
        }
        for event in events
    ]
    fp_path = out_dir / "approval-event-fingerprints.jsonl"
    with fp_path.open("w", encoding="utf-8") as fh:
        for entry in fingerprints:
            fh.write(json.dumps(entry, sort_keys=True, ensure_ascii=False))
            fh.write("\n")


def load_event_fingerprints(out_dir: Path) -> set[str]:
    fp_path = out_dir / "approval-event-fingerprints.jsonl"
    if not fp_path.exists():
        return set()
    out: set[str] = set()
    for line in fp_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        fp = obj.get("fingerprint")
        if isinstance(fp, str):
            out.add(fp)
    return out


def compute_event_delta(
    before_dir: Path,
    after_dir: Path,
    delta_path: Path,
) -> list[dict[str, Any]]:
    """Compute the set difference of event fingerprints before/after.

    Returns the new events (in `after`) whose fingerprint did not exist
    in `before`. Writes them as JSONL to `delta_path`.
    """
    before = load_event_fingerprints(before_dir)
    after_path = after_dir / "approval-events.jsonl"

    delta: list[dict[str, Any]] = []
    with after_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            fp = event_fingerprint(event)
            if fp not in before:
                delta.append(event)

    with delta_path.open("w", encoding="utf-8") as fh:
        for event in delta:
            fh.write(json.dumps(event, sort_keys=True, ensure_ascii=False))
            fh.write("\n")

    return delta


def discriminator_for_event(event: dict[str, Any]) -> dict[str, Any]:
    """Project a normalized event into the stable discriminator schema.

    Every field is `null` when not present; never inferred. The schema
    is the minimum the upstream policy-vs-control-flow distinction
    depends on (per the reviewer's discriminator list).
    """
    parsed = event.get("event") or {}
    src = event.get("source") or ""

    def pick(*keys: str) -> Any:
        for k in keys:
            if isinstance(parsed, dict) and k in parsed and parsed[k] is not None:
                return parsed[k]
        return None

    return {
        "schema": DISCRIMINATOR_SCHEMA,
        "toolName": pick("toolName", "tool_name", "tool"),
        "correlationId": pick("correlationId", "correlation_id", "id", "requestId"),
        "sessionId": pick("sessionId", "session_id", "taskId", "task_id"),
        "policyAutoApprove": pick("autoApproveAll", "autoApprove", "policyAutoApprove"),
        "shouldAutoApproveTool": pick("shouldAutoApproveTool", "shouldAutoApprove", "shouldAutoApproveToolResult"),
        "approvalEntryObserved": pick("eventType") == "approval.entry.v2"
        or "approval.entry.v2" in (event.get("raw") or ""),
        "approvalTerminalObserved": pick("eventType") == "approval.terminal.v2"
        or "approval.terminal.v2" in (event.get("raw") or ""),
        "source": src,
    }


def write_discriminator(
    out_dir: Path, delta: list[dict[str, Any]]
) -> dict[str, Any]:
    """Write approval-discriminator.json from a delta.

    The discriminator holds only fields that are actually present in
    the delta; absent fields stay `null`. This is the stable view the
    ACT consumes even if the underlying diagnostic JSON changes
    shape slightly.
    """
    items = [discriminator_for_event(event) for event in delta]
    payload = {
        "schema": DISCRIMINATOR_SCHEMA,
        "capturedAt": utc_now(),
        "deltaSize": len(items),
        "items": items,
    }
    dump_json(out_dir / "approval-discriminator.json", payload)
    return payload


def collect_git(repo: Path, out_dir: Path) -> dict[str, Any]:
    info = {
        "repo": str(repo),
        "head": git(repo, "rev-parse", "HEAD"),
        "tree": git(repo, "rev-parse", "HEAD^{tree}"),
        "branch": git(repo, "branch", "--show-current"),
        "status_porcelain_v1": git(repo, "status", "--porcelain=v1"),
        "stash_list": git(repo, "stash", "list"),
    }

    lines = [
        f"REPO={info['repo']}",
        f"HEAD={info['head']}",
        f"TREE={info['tree']}",
        f"BRANCH={info['branch']}",
        "--- STATUS ---",
        info["status_porcelain_v1"] or "",
        "--- STASH ---",
        info["stash_list"] or "",
    ]
    (out_dir / "git.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return info


def write_file_manifest(out_dir: Path) -> None:
    files = []

    for path in sorted(out_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.name in {"file-manifest.json", "SHA256SUMS"}:
            continue

        files.append(
            {
                "path": str(path.relative_to(out_dir)),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            }
        )

    dump_json(out_dir / "file-manifest.json", files)

    with (out_dir / "SHA256SUMS").open("w", encoding="utf-8") as fh:
        for item in files:
            fh.write(f"{item['sha256']}  {item['path']}\n")


def append_capture_index(root: Path, record: dict[str, Any]) -> None:
    index = root / "capture-index.jsonl"
    with index.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, sort_keys=True))
        fh.write("\n")


def phase_capture(
    repo: Path,
    args: argparse.Namespace,
    phase: str,
    cid: str,
    capture_root: Path,
) -> dict[str, Any]:
    """Run one phase (`pending` or `resolved`) of a capture.

    Writes manifest, git, environment, session-metadata, approval-
    events, and event-fingerprints into `capture_root/<phase>/`.
    Returns a small status dict.
    """
    phase_dir = capture_root / phase
    if phase_dir.exists():
        raise RuntimeError(f"phase directory already exists: {phase_dir}")
    phase_dir.mkdir(parents=True)

    roots = candidate_data_roots(args.data_dir)

    manifest = {
        "schema": CAPTURE_SCHEMA,
        "captureId": cid,
        "phase": phase,
        "capturedAt": utc_now(),
        "act": args.act,
        "repo": str(repo),
        "dataRoots": [str(p) for p in roots],
        "recentMinutes": args.recent_minutes,
        "readOnlyIntent": True,
        "approvalActionPerformedByTool": False,
    }
    dump_json(phase_dir / "manifest.json", manifest)

    git_info = collect_git(repo, phase_dir)

    dump_json(
        phase_dir / "environment.json",
        {
            "capturedAt": utc_now(),
            "python": sys.version,
            "platform": platform.platform(),
            "hostname": platform.node(),
        },
    )

    sessions = collect_session_metadata(roots, phase_dir, args.recent_minutes)
    events = collect_approval_events(roots, phase_dir, args.recent_minutes)
    write_event_fingerprints(phase_dir, events)

    summary = {
        "captureId": cid,
        "phase": phase,
        "approvalEventCount": len(events),
        "sessionCandidateCount": len(sessions),
        "markers": {
            marker: sum(
                1
                for e in events
                if marker in json.dumps(e, sort_keys=True)
            )
            for marker in APPROVAL_MARKERS
        },
        "repoHead": git_info["head"],
        "classification": "UNCLASSIFIED",
    }
    dump_json(phase_dir / "approval-summary.json", summary)

    write_file_manifest(phase_dir)

    append_capture_index(
        capture_root.parent,
        {
            "captureId": cid,
            "phase": phase,
            "capturedAt": manifest["capturedAt"],
            "path": str(phase_dir.relative_to(repo)),
            "head": git_info["head"],
            "approvalEventCount": len(events),
        },
    )

    return {
        "phase_dir": phase_dir,
        "git_info": git_info,
        "events": events,
        "sessions": sessions,
        "approval_event_count": len(events),
        "session_candidate_count": len(sessions),
    }


def begin(args: argparse.Namespace) -> int:
    repo = Path(args.repo).expanduser().resolve()
    if not (repo / ".git").exists():
        print(f"ERROR: not a Git repository: {repo}", file=sys.stderr)
        return 2

    act_root = repo / ".factory" / "evidence" / args.act / "captures"
    act_root.mkdir(parents=True, exist_ok=True)

    cid = capture_id()
    capture_root = act_root / cid
    if capture_root.exists():
        print(f"ERROR: capture_id already taken: {cid}", file=sys.stderr)
        return 2

    status = phase_capture(repo, args, "pending", cid, capture_root)

    print(f"CAPTURE_ID={cid}")
    print(f"PHASE=pending")
    print(f"OUTPUT={status['phase_dir']}")
    print(f"APPROVAL_EVENTS={status['approval_event_count']}")
    print(f"SESSION_CANDIDATES={status['session_candidate_count']}")
    print("MUTATED_RUNTIME_STATE=NO")
    return 0


def classify_binding(
    discriminator_items: list[dict[str, Any]],
    session_projection_identities: set[str],
) -> tuple[str, bool, bool, int]:
    """Classify the specimen binding along two independent axes.

    Axis 1 — runtimeIdentityBound: at least one delta event carries
    a sessionId/session_id/taskId/task_id/id that also appears in
    the captured session projections. This proves session/event
    ownership; the captured event is owned by a captured runtime
    session, but it does NOT by itself identify the specific approval
    transaction the human acted on.

    Axis 2 — approvalTransactionBound: the delta contains exactly
    one qualifying approval transaction — a correlationId group
    whose members all share the same session identity (the captured
    one) and contain at least one approvalEntryObserved and at least
    one approvalTerminalObserved. When more than one correlationId
    group qualifies, the binding is demoted: session ownership can
    still be proved, but the human action cannot be uniquely
    attributed to a single transaction.

    Composition:
        specimenBinding = PASS only when BOTH axes hold.
        runtimeIdentityBound       = axis 1 proof
        approvalTransactionBound   = axis 2 proof
        qualifyingTransactionCount = number of qualifying groups

    The caller writes all four into binding.json so downstream
    consumers can distinguish "no events seen" from "events seen but
    unattributable" AND "exactly one transaction identified" from
    "multiple transactions present in the same capture window".
    """
    if not discriminator_items or not session_projection_identities:
        return ("CAPTURE_INSUFFICIENT", False, False, 0)

    # --- Axis 1: session/event identity join ---
    runtime_identity_bound = False
    for item in discriminator_items:
        if not isinstance(item, dict):
            continue
        sid = item.get("sessionId")
        if sid is None:
            continue
        if str(sid) in session_projection_identities:
            runtime_identity_bound = True
            break

    if not runtime_identity_bound:
        return ("CAPTURE_INSUFFICIENT", False, False, 0)

    # --- Axis 2: approval transaction uniqueness ---
    qualifying = collect_qualifying_transactions(
        discriminator_items=discriminator_items,
        session_projection_identities=session_projection_identities,
    )

    if len(qualifying) == 1:
        return ("PASS", True, True, 1)

    # Either zero qualifying transactions, or multiple concurrent
    # transactions — either way the human action is ambiguous or
    # absent, so demote the transaction axis but preserve the
    # session-ownership proof.
    return ("CAPTURE_INSUFFICIENT", True, False, len(qualifying))


def collect_session_projection_identities(
    session_records: list[dict[str, Any]],
) -> set[str]:
    """Project every captured session's identity fields into a set.

    Used by classify_binding to join delta events against captured
    sessions. The set is intentionally permissive about aliases: if
    any of {id, sessionId, session_id, taskId, task_id} is present on
    any captured session, its stringified value joins the set.

    This is not "any string matches any string" — it is a strict set
    of observed identity values, so an event whose sessionId is
    session-B will not falsely match a captured session-A whose only
    identity field is sessionId=session-A.
    """
    identities: set[str] = set()
    for record in session_records:
        projection = record.get("projection") or {}
        if not isinstance(projection, dict):
            continue
        for key in SESSION_ID_KEYS:
            value = projection.get(key)
            if value is None:
                continue
            identities.add(str(value))
    return identities


def collect_qualifying_transactions(
    discriminator_items: list[dict[str, Any]],
    session_projection_identities: set[str],
) -> list[dict[str, Any]]:
    """Group delta events by correlationId and return the qualifying
    approval transactions.

    A transaction is "qualifying" iff:
      * correlationId is a non-empty string (distinguish from
        anonymous events);
      * the group carries EXACTLY ONE distinct sessionId, and that
        sessionId is in session_projection_identities (the
        transaction is wholly owned by ONE captured runtime; a
        correlation group spanning two captured sessions is
        incoherent — upstream's approval contract ties the approval
        identity to the routing sessionId, so a single approval
        transaction cannot truthfully span sessions);
      * at least one event has approvalEntryObserved AND at least
        one has approvalTerminalObserved (complete entry→terminal
        cycle).

    Note: the previously documented predicate "every member's
    sessionId joins the captured projection" was WRONG — it proved
    "every session the group touches belongs to SOME captured
    session", which silently admitted a cross-session split when
    two captured sessions both appeared in the group. The strict
    single-session invariant is the correct one (see the
    fifth-cycle addendum / HALT_CROSS_SESSION_TRANSACTION_JOIN).

    This does NOT reconstruct upstream's internal approvalId; the
    correlationId emitted by the diagnostic seam is the correlation
    authority on the events the tool can see.
    """
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in discriminator_items:
        if not isinstance(item, dict):
            continue
        cid = item.get("correlationId")
        if not cid or not isinstance(cid, str):
            continue
        groups.setdefault(cid, []).append(item)

    qualifying: list[dict[str, Any]] = []
    for cid, members in groups.items():
        if not members:
            continue
        session_ids = {
            str(m.get("sessionId"))
            for m in members
            if m.get("sessionId") is not None
        }
        # The transaction must be wholly owned by ONE captured
        # session — not "every member is captured", not "at least
        # one member is captured". This rejects the
        # session-A-entry/session-B-terminal split as incoherent.
        if len(session_ids) != 1:
            continue
        (sole_session_id,) = session_ids
        if sole_session_id not in session_projection_identities:
            continue
        has_entry = any(m.get("approvalEntryObserved") for m in members)
        has_terminal = any(m.get("approvalTerminalObserved") for m in members)
        if not (has_entry and has_terminal):
            continue
        qualifying.append({
            "correlationId": cid,
            "memberCount": len(members),
            "sessionIds": sorted(session_ids),
            "hasEntry": has_entry,
            "hasTerminal": has_terminal,
        })
    return qualifying


def finish(args: argparse.Namespace) -> int:
    repo = Path(args.repo).expanduser().resolve()
    if not (repo / ".git").exists():
        print(f"ERROR: not a Git repository: {repo}", file=sys.stderr)
        return 2

    if not args.capture_id:
        print(
            "ERROR: --capture-id is required for finish "
            "(prevents the pre-correction P0.1 defect)",
            file=sys.stderr,
        )
        return 2

    act_root = repo / ".factory" / "evidence" / args.act / "captures"
    capture_root = act_root / args.capture_id
    pending_dir = capture_root / "pending"
    resolved_dir = capture_root / "resolved"

    if not pending_dir.exists():
        print(
            f"ERROR: missing pending phase for capture {args.capture_id} "
            "(was begin ever run for this id?)",
            file=sys.stderr,
        )
        return 2

    if resolved_dir.exists():
        print(
            f"ERROR: resolved phase already exists: {resolved_dir}",
            file=sys.stderr,
        )
        return 2

    # Refuse if the pending capture was not produced by THIS corrected
    # tool (schema mismatch = pre-correction v1).
    pending_manifest = pending_dir / "manifest.json"
    if pending_manifest.exists():
        try:
            pm = json.loads(pending_manifest.read_text(encoding="utf-8"))
            if pm.get("schema") != CAPTURE_SCHEMA:
                print(
                    f"ERROR: pending manifest schema {pm.get('schema')!r} "
                    f"does not match {CAPTURE_SCHEMA!r}. Refusing to "
                    f"compute a delta against a pre-correction pending "
                    f"snapshot. Re-run `begin` to produce a corrected "
                    f"pending capture first.",
                    file=sys.stderr,
                )
                return 2
        except (OSError, json.JSONDecodeError) as exc:
            print(
                f"ERROR: pending manifest unreadable: {exc}",
                file=sys.stderr,
            )
            return 2

    status = phase_capture(
        repo, args, "resolved", args.capture_id, capture_root
    )

    delta = compute_event_delta(
        pending_dir,
        status["phase_dir"],
        status["phase_dir"] / "approval-events-delta.jsonl",
    )
    shutil.copyfile(
        pending_dir / "approval-events.jsonl",
        status["phase_dir"] / "approval-events-before.jsonl",
    )
    try:
        os.link(
            status["phase_dir"] / "approval-events.jsonl",
            status["phase_dir"] / "approval-events-after.jsonl",
        )
    except OSError:
        shutil.copyfile(
            status["phase_dir"] / "approval-events.jsonl",
            status["phase_dir"] / "approval-events-after.jsonl",
        )

    discriminator = write_discriminator(status["phase_dir"], delta)

    # Identity join (P0 closure): the captured event is only causally
    # linkable to the captured session when at least one delta event
    # carries a sessionId/session_id/taskId/task_id/id whose value also
    # appears in the captured session projection. Anything weaker than
    # an actual set intersection is CAPTURE_INSUFFICIENT regardless of
    # counts.
    session_records = json.loads(
        (status["phase_dir"] / "session-metadata" / "index.json").read_text()
    )
    session_projection_identities = collect_session_projection_identities(
        session_records
    )

    binding, runtime_identity_bound, approval_transaction_bound, qualifying_transaction_count = classify_binding(
        discriminator_items=discriminator["items"],
        session_projection_identities=session_projection_identities,
    )

    binding_payload = {
        "schema": BINDING_SCHEMA,
        "captureId": args.capture_id,
        "act": args.act,
        "capturedAt": utc_now(),
        "pendingDir": str(pending_dir.relative_to(repo)),
        "resolvedDir": str(status["phase_dir"].relative_to(repo)),
        "pendingApprovalEventCount": (
            json.loads((pending_dir / "approval-summary.json").read_text())
            .get("approvalEventCount", 0)
        ),
        "resolvedApprovalEventCount": status["approval_event_count"],
        "pendingSessionCandidateCount": (
            json.loads((pending_dir / "approval-summary.json").read_text())
            .get("sessionCandidateCount", 0)
        ),
        "resolvedSessionCandidateCount": status["session_candidate_count"],
        "deltaSize": len(delta),
        "humanChronologyBound": True,
        # Axis 1 — session/event ownership (proved by the identity join).
        "runtimeIdentityBound": runtime_identity_bound,
        # Axis 2 — exactly one entry↔terminal correlation group proves
        # the human's specific approval transaction was identified.
        "approvalTransactionBound": approval_transaction_bound,
        "qualifyingTransactionCount": qualifying_transaction_count,
        "sessionBindingAvailable": status["session_candidate_count"] > 0,
        "eventDeltaBound": True,
        "artifactStatus": "PASS",
        "specimenBinding": binding,
    }
    dump_json(status["phase_dir"] / "binding.json", binding_payload)
    write_file_manifest(status["phase_dir"])

    print(f"CAPTURE_ID={args.capture_id}")
    print(f"PHASE=resolved")
    print(f"OUTPUT={status['phase_dir']}")
    print(f"APPROVAL_EVENTS={status['approval_event_count']}")
    print(f"SESSION_CANDIDATES={status['session_candidate_count']}")
    print(f"SESSION_PROJECTION_IDENTITIES={sorted(session_projection_identities)}")
    print(f"NEW_EVENTS={len(delta)}")
    print(f"DISCRIMINATOR_ITEMS={len(discriminator['items'])}")
    print(f"QUALIFYING_TRANSACTIONS={qualifying_transaction_count}")
    print(f"SPECIMEN_BINDING={binding}")
    print(f"RUNTIME_IDENTITY_BOUND={'YES' if runtime_identity_bound else 'NO'}")
    print(f"APPROVAL_TRANSACTION_BOUND={'YES' if approval_transaction_bound else 'NO'}")
    print(f"ARTIFACT_STATUS=PASS")
    print("MUTATED_RUNTIME_STATE=NO")
    return 0
def report(args: argparse.Namespace) -> int:
    repo = Path(args.repo).expanduser().resolve()
    if not (repo / ".git").exists():
        print(f"ERROR: not a Git repository: {repo}", file=sys.stderr)
        return 2

    if not args.capture_id:
        print(
            "ERROR: --capture-id is required for report",
            file=sys.stderr,
        )
        return 2

    act_root = repo / ".factory" / "evidence" / args.act / "captures"
    capture_root = act_root / args.capture_id
    resolved_dir = capture_root / "resolved"
    pending_dir = capture_root / "pending"

    if not pending_dir.exists() or not resolved_dir.exists():
        print(
            f"ERROR: capture {args.capture_id} is incomplete "
            f"(need both pending/ and resolved/)",
            file=sys.stderr,
        )
        return 2

    binding = json.loads((resolved_dir / "binding.json").read_text())
    discriminator = json.loads(
        (resolved_dir / "approval-discriminator.json").read_text()
    )

    items = discriminator.get("items", [])
    item = items[0] if items else {}

    text_lines = [
        f"SPECIMEN_BINDING={binding.get('specimenBinding', 'UNKNOWN')}",
        f"ARTIFACT_STATUS={binding.get('artifactStatus', 'UNKNOWN')}",
        f"CAPTURE_ID={args.capture_id}",
        f"ACT={args.act}",
        f"PENDING_APPROVAL_EVENTS={binding.get('pendingApprovalEventCount')}",
        f"RESOLVED_APPROVAL_EVENTS={binding.get('resolvedApprovalEventCount')}",
        f"NEW_EVENTS={binding.get('deltaSize')}",
        f"PENDING_SESSION_CANDIDATES={binding.get('pendingSessionCandidateCount')}",
        f"RESOLVED_SESSION_CANDIDATES={binding.get('resolvedSessionCandidateCount')}",
        f"RUNTIME_IDENTITY_BOUND={'YES' if binding.get('runtimeIdentityBound') else 'NO'}",
        f"APPROVAL_TRANSACTION_BOUND={'YES' if binding.get('approvalTransactionBound') else 'NO'}",
        f"QUALIFYING_TRANSACTIONS={binding.get('qualifyingTransactionCount', 0)}",
        f"SESSION_BINDING_AVAILABLE={'YES' if binding.get('sessionBindingAvailable') else 'NO'}",
        f"EVENT_DELTA_BOUND={'YES' if binding.get('eventDeltaBound') else 'NO'}",
        f"TASK_ID={item.get('sessionId') or ''}",
        f"TOOL_NAME={item.get('toolName') or ''}",
        f"CORRELATION_ID={item.get('correlationId') or ''}",
        f"POLICY_AUTO_APPROVE={item.get('policyAutoApprove') or ''}",
        f"SHOULD_AUTO_APPROVE={item.get('shouldAutoApproveTool') or ''}",
        f"APPROVAL_ENTRY={'true' if item.get('approvalEntryObserved') else 'false'}",
        f"APPROVAL_TERMINAL={'true' if item.get('approvalTerminalObserved') else 'false'}",
    ]
    text_report = "\n".join(text_lines) + "\n"

    report_payload = {
        "schema": REPORT_SCHEMA,
        "capturedAt": utc_now(),
        "binding": binding,
        "discriminator": discriminator,
    }

    dump_json(resolved_dir / "report.json", report_payload)
    (resolved_dir / "report.txt").write_text(text_report, encoding="utf-8")

    sys.stdout.write(text_report)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description=(
            "Persist a read-only ClineMM approval specimen. "
            "Subcommands: begin, finish, report. "
            "(`snapshot --phase` was removed in "
            "ACT-CLINEMM-APPROVAL-SPECIMEN-CAPTURE-TOOL01-CORRECTION01.)"
        )
    )

    sub = p.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--repo",
        default=".",
        help="ClineMM repository root (default: cwd)",
    )
    common.add_argument("--act", required=True)
    common.add_argument(
        "--data-dir",
        action="append",
        default=[],
        help="Cline data root; repeatable. Default discovers ~/.cline*",
    )
    common.add_argument(
        "--recent-minutes",
        type=int,
        default=DEFAULT_RECENT_MINUTES,
    )

    b = sub.add_parser("begin", parents=[common])
    b.set_defaults(func=begin)

    f = sub.add_parser("finish", parents=[common])
    f.add_argument(
        "--capture-id",
        required=True,
        help=(
            "The capture ID printed by `begin`. REQUIRED — refusing a "
            "finish without it is the P0.1 invariant."
        ),
    )
    f.set_defaults(func=finish)

    r = sub.add_parser("report", parents=[common])
    r.add_argument(
        "--capture-id",
        required=True,
        help="The capture ID printed by `begin`.",
    )
    r.set_defaults(func=report)

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
