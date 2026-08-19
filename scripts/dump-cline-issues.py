#!/usr/bin/env python3
"""
Compact upstream-issue intake substrate for Cline--.

Fetches currently open issues from a GitHub repository (default: cline/cline),
excludes pull requests, follows GitHub-provided `Link rel="next"` pagination,
tolerates interruption via a checkpoint file, and emits a compact JSON index
under `.factory/upstream/`.

Design contract (ACT-CLINEMM-UPSTREAM-ISSUE-INTAKE-SUBSTRATE01):

  - Link-header is the pagination authority; we never manually increment a
    page counter against the API.
  - The committed snapshot stores ONLY fields needed for offline popularity /
    value triage. No bodies. No comment bodies. No PII. No avatar URLs.
  - The committed snapshot is deterministic for a given upstream payload:
    sorted by `interactions` desc, then `updated_at` desc, then `number` desc.
  - Writes are atomic: temp file + os.replace.
  - The checkpoint lives outside the repo (under $TMPDIR). It is removed on
    successful completion.
  - GitHub tokens come from $GITHUB_TOKEN only. They are never logged,
    echoed, persisted, or embedded in any output.

This script is tooling, not product runtime.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SCHEMA_VERSION = 1
DEFAULT_OWNER = "cline"
DEFAULT_REPO = "cline"
DEFAULT_OUTPUT = Path(".factory/upstream/cline-open-issues-index.json")
CHECKPOINT_FILENAME = "cline-open-issues-checkpoint.json"

# Bytes thresholds (per ACT contract).
PREFERRED_MAX_BYTES = 1 * 1024 * 1024          # 1 MiB
ACCEPTABLE_MAX_BYTES = 2 * 1024 * 1024         # 2 MiB
DEFAULT_MAX_COMMITTED_ISSUES = 500

# Keyword / label families that flag high-value Cline-- candidates.
HIGH_VALUE_KEYWORDS = (
    "context", "compact", "token", "prompt", "checkpoint",
    "retry", "recovery", "terminal", "tool", "provider", "model",
    "performance", "memory", "mcp", "state", "waiting", "task",
    "install", "release", "vscode",
)

# HTTP status codes that should trigger a bounded retry.
RETRYABLE_STATUS_CODES = {403, 429, 500, 502, 503, 504}
MAX_RETRIES = 5
DEFAULT_RETRY_BACKOFF = 2  # seconds; exponentiated as 2 ** attempt


# ---------------------------------------------------------------------------
# HTTP layer
# ---------------------------------------------------------------------------


def build_request_headers() -> dict:
    """Build a fresh request-header dict. Auth header added only if a token
    is present in the environment. The token itself is intentionally never
    returned by this function (and never persisted anywhere)."""
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "clinemm-upstream-issue-intake",
    }
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        # Authorization header is constructed per-request, never stored.
        headers["Authorization"] = f"Bearer {token}"
    return headers


def request_json(url: str) -> tuple:
    """Fetch `url` and return (parsed_json, response_headers_dict).

    Retries on transient / rate-related status codes with bounded exponential
    backoff. Honors `Retry-After` when the server supplies it. On HTTP 422,
    the response body is written to stderr and the exception is re-raised
    (422 is treated as terminal per the ACT contract)."""
    headers = build_request_headers()
    req = urllib.request.Request(url, headers=headers)

    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                payload = json.load(response)
                # Header keys are case-insensitive in HTTP; urllib returns
                # `Message` whose `get(...)` is already case-insensitive, but
                # we normalize to a plain dict[str, str] for downstream use.
                hdrs = {k: response.headers.get(k) for k in response.headers.keys()}
                return payload, hdrs
        except urllib.error.HTTPError as exc:
            # Always log only the status code; never the response body
            # unless it is a 422, where the contract mandates stderr echo.
            if exc.code == 422:
                body_preview = ""
                try:
                    raw = exc.read()
                    body_preview = raw.decode("utf-8", errors="replace")[:2000]
                except Exception:
                    pass
                print(
                    f"HTTP 422 Unprocessable Entity at {url}\n--- body ---\n{body_preview}\n------------",
                    file=sys.stderr,
                )
                raise

            if exc.code in RETRYABLE_STATUS_CODES and attempt < MAX_RETRIES - 1:
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                if retry_after is not None:
                    try:
                        delay = float(retry_after)
                    except ValueError:
                        delay = DEFAULT_RETRY_BACKOFF ** attempt
                else:
                    delay = DEFAULT_RETRY_BACKOFF ** attempt
                print(
                    f"HTTP {exc.code}; retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})",
                    file=sys.stderr,
                )
                time.sleep(delay)
                continue
            raise

    raise RuntimeError("unreachable: retry loop exhausted")


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


def parse_next_link(link_header):
    """Return the `rel="next"` URL from a GitHub-style Link header, or None.

    Accepts:
      - None                          -> None
      - header with no `next`         -> None
      - header with `next` somewhere  -> exact next URL (string)
      - multiple rel= entries         -> selects only rel="next"
      - malformed irrelevant parts    -> safely ignored where reasonable

    The parser never infers pagination; it only inspects the response.
    """
    if not link_header:
        return None
    # RFC 5988 reference: `<URL>; rel="next"`. Commas may separate entries.
    # We split on commas not inside angle-bracketed URLs by scanning.
    entries = []
    depth = 0
    buf = []
    for ch in link_header:
        if ch == "<":
            depth += 1
        elif ch == ">":
            depth -= 1
        if ch == "," and depth == 0:
            entries.append("".join(buf).strip())
            buf = []
        else:
            buf.append(ch)
    if buf:
        entries.append("".join(buf).strip())

    for entry in entries:
        # entry: <url>; rel="next"; other="..."
        m = re.match(r"\s*<\s*([^>]+)\s*>", entry)
        if not m:
            continue
        url = m.group(1)
        # Find rel="..." within the entry
        rel_match = re.search(r'rel\s*=\s*"([^"]+)"', entry)
        if rel_match and rel_match.group(1) == "next":
            return url
    return None


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------


def normalize_issue(item):
    """Reduce a raw GitHub issues-listing entry to the compact intake row.

    Returns None for pull requests (which share the endpoint) and for items
    missing the `number` field (which would be ambiguous to dedupe).

    Pure: same input -> same output, no I/O, no logging, no exception leakage.
    """
    if not isinstance(item, dict):
        return None
    if "pull_request" in item:
        return None
    if "number" not in item or not isinstance(item["number"], int):
        return None

    reactions_obj = item.get("reactions") or {}
    if not isinstance(reactions_obj, dict):
        reactions_obj = {}
    reactions_total = reactions_obj.get("total_count") or 0
    try:
        reactions_total = int(reactions_total)
    except (TypeError, ValueError):
        reactions_total = 0

    comments = item.get("comments") or 0
    try:
        comments = int(comments)
    except (TypeError, ValueError):
        comments = 0

    labels = item.get("labels") or []
    label_names = []
    for label in labels:
        if isinstance(label, dict):
            name = label.get("name")
        else:
            name = label
        if isinstance(name, str):
            label_names.append(name)
    label_names.sort()  # deterministic

    title = item.get("title") or ""
    html_url = item.get("html_url") or ""
    created_at = item.get("created_at") or ""
    updated_at = item.get("updated_at") or ""

    return {
        "number": item["number"],
        "title": title,
        "url": html_url,
        "created_at": created_at,
        "updated_at": updated_at,
        "comments": comments,
        "reactions": reactions_total,
        "interactions": reactions_total + comments,
        "labels": label_names,
    }


def is_high_value(issue):
    """Return True iff `issue` matches a high-value keyword/label family.

    A match occurs when any keyword is a case-insensitive substring of the
    title OR any keyword equals (case-insensitive) any label name.
    """
    keywords_lower = tuple(k.lower() for k in HIGH_VALUE_KEYWORDS)
    title = (issue.get("title") or "").lower()
    if any(kw in title for kw in keywords_lower):
        return True
    labels_lower = {(lbl or "").lower() for lbl in issue.get("labels") or []}
    if any(kw in labels_lower for kw in keywords_lower):
        return True
    return False


# ---------------------------------------------------------------------------
# Deterministic ordering
# ---------------------------------------------------------------------------


def sort_issues(issues):
    """Stable, deterministic ordering:
      1. interactions DESC
      2. updated_at DESC
      3. number DESC (tie-breaker; higher issue number first)
    """
    # Phase 1: stable sort by number DESC (innermost tie-breaker).
    # Phase 2: stable sort by updated_at DESC (using `reverse=True`).
    # Phase 3: stable sort by interactions DESC (using `reverse=True`).
    # Python's `sorted` is stable, so each later sort preserves order on ties.
    by_number = sorted(issues, key=lambda i: i["number"], reverse=True)
    by_updated_at = sorted(by_number, key=lambda i: i["updated_at"], reverse=True)
    by_interactions = sorted(
        by_updated_at, key=lambda i: i["interactions"], reverse=True
    )
    return by_interactions


# ---------------------------------------------------------------------------
# Checkpoint / resume
# ---------------------------------------------------------------------------


def checkpoint_path() -> Path:
    tmp_root = os.environ.get("TMPDIR") or "/tmp"
    return Path(tmp_root) / CHECKPOINT_FILENAME


def write_checkpoint(repo: str, next_url: str, accumulated):
    """Persist a checkpoint atomically. Token never appears here."""
    payload = {
        "schema_version": SCHEMA_VERSION,
        "repository": repo,
        "next_url": next_url,
        "issues": accumulated,
    }
    path = checkpoint_path()
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    os.replace(tmp, path)


def read_checkpoint(repo: str):
    """Return (next_url, accumulated_issues) or (None, []) if absent/mismatched.

    A mismatched checkpoint (different repo or schema_version) is rejected
    with an explicit error -- we never silently compose incompatible data.
    """
    path = checkpoint_path()
    if not path.exists():
        return None, []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SystemExit(
            f"checkpoint at {path} is not valid JSON; remove it or pass --fresh ({exc})"
        )
    if raw.get("schema_version") != SCHEMA_VERSION:
        raise SystemExit(
            f"checkpoint at {path} has schema_version={raw.get('schema_version')!r}, "
            f"expected {SCHEMA_VERSION}; remove it or pass --fresh"
        )
    if raw.get("repository") != repo:
        raise SystemExit(
            f"checkpoint at {path} was for repository={raw.get('repository')!r}, "
            f"current target is {repo!r}; remove it or pass --fresh"
        )
    return raw.get("next_url"), list(raw.get("issues") or [])


def clear_checkpoint() -> None:
    path = checkpoint_path()
    if path.exists():
        path.unlink()


# ---------------------------------------------------------------------------
# Atomic output
# ---------------------------------------------------------------------------


def write_snapshot_atomic(path: Path, payload: dict) -> None:
    """Write `payload` to `path` atomically: temp file + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    # Flush to disk before replace so a power-loss between replace() and
    # close() cannot produce a half-written canonical snapshot.
    try:
        with open(tmp, "rb", buffering=0) as f:
            os.fsync(f.fileno())
    except OSError:
        # Some filesystems (e.g. tmpfs on macOS) reject fsync; non-fatal.
        pass
    os.replace(tmp, path)


# ---------------------------------------------------------------------------
# Truncation policy
# ---------------------------------------------------------------------------


def select_committed(issues, max_committed: int) -> tuple:
    """Apply the bounded selection policy.

    Returns (committed_list, total_open_count, truncated_flag, selection_policy).

    The committed list is:
      - top `max_committed` by sort order  (popularity)
      - PLUS every issue matching `is_high_value` (Cline-- value)
      - deduplicated by `number`.

    We never silently truncate: every truncation records what happened.
    """
    total = len(issues)
    if total <= max_committed:
        # Still apply the high-value promotion to keep selection policy honest.
        top = list(issues)
    else:
        top = list(issues[:max_committed])

    high_value = [it for it in issues if is_high_value(it)]
    seen = {it["number"] for it in top}
    for it in high_value:
        if it["number"] not in seen:
            top.append(it)
            seen.add(it["number"])

    truncated = total > len(top)
    if truncated:
        policy = (
            f"top-{max_committed}-by-interactions + high-value keywords "
            f"({', '.join(HIGH_VALUE_KEYWORDS)})"
        )
    else:
        policy = "no truncation"
    return top, total, truncated, policy


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def run(owner: str, repo: str, output: Path, fresh: bool,
        max_committed: int = DEFAULT_MAX_COMMITTED_ISSUES) -> dict:
    if fresh:
        clear_checkpoint()

    repository = f"{owner}/{repo}"
    start_url = (
        f"https://api.github.com/repos/{owner}/{repo}/issues"
        f"?{urllib.parse.urlencode({'state': 'open', 'per_page': 100, 'page': 1, 'sort': 'updated', 'direction': 'desc'})}"
    )

    next_url, accumulated = read_checkpoint(repository)
    if next_url is None:
        next_url = start_url
        accumulated = []

    page_count = 0
    api_items = 0
    prs_excluded = 0
    checkpoint_used = bool(accumulated)

    while next_url:
        page_count += 1
        batch, headers = request_json(next_url)
        if not isinstance(batch, list):
            raise SystemExit(
                f"unexpected non-list payload from GitHub at {next_url}: {type(batch).__name__}"
            )
        api_items += len(batch)
        for item in batch:
            if "pull_request" in item:
                prs_excluded += 1
                continue
            normalized = normalize_issue(item)
            if normalized is not None:
                accumulated.append(normalized)

        print(
            f"page={page_count} fetched={len(batch)} "
            f"prs_excluded_so_far={prs_excluded} "
            f"open_issues_so_far={len(accumulated)}",
            file=sys.stderr,
        )

        # Next URL is exclusively derived from the response Link header.
        next_link = parse_next_link(headers.get("Link"))
        next_url = next_link
        if next_url is None:
            break

        # Checkpoint after each successfully processed page so the next
        # invocation can resume from exactly where we left off.
        write_checkpoint(repository, next_url, accumulated)

    committed, total_open, truncated, policy = select_committed(
        sort_issues(accumulated), max_committed
    )

    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "repository": repository,
        "state": "open",
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "issue_count": len(committed),
        "total_open_issue_count": total_open,
        "truncated": truncated,
        "selection_policy": policy,
        "source_api": "github-rest",
        "issues": committed,
    }

    write_snapshot_atomic(output, snapshot)
    clear_checkpoint()

    return {
        "page_count": page_count,
        "api_items": api_items,
        "prs_excluded": prs_excluded,
        "open_issues_total": total_open,
        "committed_issue_count": len(committed),
        "truncated": truncated,
        "selection_policy": policy,
        "checkpoint_used": checkpoint_used,
        "output_path": str(output),
    }


def parse_args(argv=None):
    parser = argparse.ArgumentParser(
        description="Compact upstream-issue intake substrate for Cline--."
    )
    parser.add_argument("--owner", default=DEFAULT_OWNER)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="ignore/delete any existing checkpoint and start over",
    )
    parser.add_argument(
        "--max-committed-issues",
        type=int,
        default=DEFAULT_MAX_COMMITTED_ISSUES,
        help=(
            f"max issues to keep when truncation policy triggers "
            f"(default: {DEFAULT_MAX_COMMITTED_ISSUES})"
        ),
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    stats = run(
        owner=args.owner,
        repo=args.repo,
        output=args.output,
        fresh=args.fresh,
        max_committed=args.max_committed_issues,
    )
    print(json.dumps(stats, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
