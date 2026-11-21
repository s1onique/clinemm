#!/usr/bin/env python3
"""
ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION01 — F2 evidence-strength probe.

The parent ACT reported an "information gain" classification that was really
just a NONEMPTY check, and it then treated "186 novel results" as proof of
productive evidence collection. CORRECTION01 F2 requires the tiers to be
distinguished:

    EMPTY            -- no result body
    NONEMPTY         -- a result body exists
    CONTENT_DISTINCT -- the body differs from every other body seen so far
    FACTUALLY_NOVEL  -- the read contributed a fact that had not been
                        observed from that source before

FACTUALLY_NOVEL at the level of decision-relevance is NOT claimed here: that
would require independent adjudication of R1-R10, which this ACT does not
perform. What IS measured is the stricter, mechanically verifiable
per-SOURCE novelty:

    For every read attributable to a source (a file path or a URL), the set of
    normalised lines in the result is compared against the union of lines
    already seen from that SAME source. A read adding no unseen line is a
    pure re-read; a read adding unseen lines contributed NEW SOURCE CONTENT.

Usage:
    python3 novelty-probe.py --session-dir <private> --out <dir>/novelty-probe.json
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import re
import sys
from typing import Any

SOURCE_RE = re.compile(
    r"(/[A-Za-z0-9_./-]+\.(?:yaml|yml|java|sh|xml|sql|properties|json|md|txt|conf)"
    r"|https?://[^\s'\"]+)"
)


def source_of(query: str) -> str | None:
    found = SOURCE_RE.findall(query)
    return found[0] if found else None


def normalised_lines(text: str) -> set[str]:
    return {line.strip() for line in text.split("\n") if line.strip()}

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-dir", required=True)
    parser.add_argument("--session-id", default="1795252560069_t82cp")
    parser.add_argument("--operator-index", type=int, default=650)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    path = f"{args.session_dir}/{args.session_id}.messages.json"
    with open(path, "r", encoding="utf-8") as handle:
        doc = json.load(handle)
    messages = doc.get("messages") or []

    results: dict[str, tuple[int, str, str]] = {}
    for index, message in enumerate(messages):
        for block in message.get("content") or []:
            if block.get("type") != "tool_result":
                continue
            content = block.get("content") or []
            query = " ".join(
                str(x.get("query") or "") for x in content if isinstance(x, dict)
            )
            body = "".join(
                str(x.get("result") or "") for x in content if isinstance(x, dict)
            )
            results[block.get("tool_use_id")] = (index, query, body)

    calls: list[tuple[int, str, str]] = []
    for index, message in enumerate(messages):
        for block in message.get("content") or []:
            if block.get("type") == "tool_use":
                calls.append((index, block.get("id"), block.get("name")))

    # ---- Tiers 1-3 over all autonomous results ----
    seen_bodies: set[str] = set()
    tier = collections.Counter()
    per_source: dict[str, list[tuple[int, str]]] = collections.defaultdict(list)

    for index, call_id, name in calls:
        if index >= args.operator_index:
            continue
        result = results.get(call_id)
        if result is None:
            continue
        _, query, body = result
        if not body.strip():
            tier["EMPTY"] += 1
            continue
        fingerprint = hashlib.sha256(body.encode("utf-8")).hexdigest()
        if fingerprint in seen_bodies:
            tier["NONEMPTY_DUPLICATE_BODY"] += 1
        else:
            seen_bodies.add(fingerprint)
            tier["CONTENT_DISTINCT"] += 1
        source = source_of(query)
        if source:
            per_source[source].append((index, body))

    # ---- Tier 4: per-SOURCE novelty (mechanically verifiable) ----
    reads = 0
    reads_with_new_lines = 0
    reads_with_zero_new_lines = 0
    total_new_lines = 0
    source_report: list[dict[str, Any]] = []
    for source, entries in per_source.items():
        entries.sort()
        seen: set[str] = set()
        new_total = 0
        zero_new = 0
        for _, body in entries:
            lines = normalised_lines(body)
            fresh = lines - seen
            reads += 1
            if fresh:
                reads_with_new_lines += 1
                new_total += len(fresh)
            else:
                reads_with_zero_new_lines += 1
                zero_new += 1
            seen |= lines
        total_new_lines += new_total
        source_report.append(
            {
                # The source path/URL may itself be sensitive (private repo
                # paths), so only a non-reversible fingerprint is published.
                "source_fingerprint": "sha256:"
                + hashlib.sha256(source.encode("utf-8")).hexdigest()[:16],
                "source_kind": "URL" if source.startswith("http") else "FILE_PATH",
                "reads": len(entries),
                "reads_adding_no_new_lines": zero_new,
                "new_distinct_lines_added": new_total,
            }
        )
    source_report.sort(
        key=lambda r: (-r["new_distinct_lines_added"], r["source_fingerprint"])
    )

    result = {
        "probe_id": "CORRECTION01_F2_EVIDENCE_STRENGTH_V1",
        "semantics": {
            "EMPTY": "no result body",
            "NONEMPTY_DUPLICATE_BODY": (
                "a body exists and is byte-identical to an earlier body"
            ),
            "CONTENT_DISTINCT": (
                "a body exists and differs from every other body seen"
            ),
            "FACTUALLY_NOVEL": (
                "NOT ESTABLISHED AT THIS LAYER -- would require independent "
                "adjudication of R1-R10, which this ACT does not perform"
            ),
            "SOURCE_CONTENT_NOVEL": (
                "a read of the SAME source added at least one normalised line "
                "that had not been observed from that source before"
            ),
        },
        "body_tier_counts": dict(tier),
        "source_reads_total": reads,
        "source_reads_adding_new_lines": reads_with_new_lines,
        "source_reads_adding_zero_new_lines": reads_with_zero_new_lines,
        "total_new_distinct_lines_added": total_new_lines,
        "distinct_sources_read": len(per_source),
        "sources": source_report,
        "operator_input_index": args.operator_index,
    }

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(f"body tiers: {json.dumps(dict(tier), sort_keys=True)}")
    print(
        f"source reads: {reads} total; {reads_with_new_lines} added new lines; "
        f"{reads_with_zero_new_lines} were pure re-reads"
    )
    print(f"total new distinct lines added: {total_new_lines}")
    print(f"distinct sources read: {len(per_source)}")
    print("FACTUALLY_NOVEL (decision-relevant): UNPROVEN at this layer")
    return 0


if __name__ == "__main__":
    sys.exit(main())
