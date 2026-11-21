#!/usr/bin/env python3
"""
ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-CORRECTION01 — F1 compaction-identity probe.

The parent ACT reported "257 compaction boundaries". That number counted
provider requests whose messages[0] was a compacted summary. A summary
PERSISTS across many requests, so that number was NOT a count of compaction
EVENTS.

This probe separates the two, using only authoritative state transitions
observable in the provider request captures:

  requests_with_compacted_summary -- how many requests carried a summary
                                     (a STATE count)
  distinct_summary_generations    -- how many distinct summary payloads
                                     existed (the identity space)
  compaction_events_observed      -- how many times the carried summary
                                     IDENTITY CHANGED, i.e. how many new
                                     compaction generations began

A change of summary identity is the observable signature of a NEW compaction,
because the runtime replaces the summary on each compaction; if the identity
did not change, no new compaction occurred.

The probe also verifies, for every request carrying a summary, whether the
task-contract section and the runtime completion obligation survived -- the
H3 retention question, which is unaffected by the counting error.

Usage:
    python3 compaction-probe.py --capture-dir <private> \
        --run-id run_3tw2rDtz --out <dir>/compaction-probe.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from typing import Any

REMINDER_MARKER = (
    "not complete until you call one of these terminal completion tools"
)
CONTRACT_MARKER = "## Active task contract (authoritative)"
EVIDENCE_MARKER = "<!-- cline-evidence:begin -->"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--capture-dir", required=True)
    parser.add_argument("--run-id", default="run_3tw2rDtz")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    prefix = f"cap_{args.run_id}_"
    captures: dict[int, dict[str, Any]] = {}
    for name in sorted(os.listdir(args.capture_dir)):
        if not name.startswith(prefix):
            continue
        if not name.endswith(".provider-request.json"):
            continue
        with open(os.path.join(args.capture_dir, name), "r", encoding="utf-8") as handle:
            capture = json.load(handle)
        iteration = (capture.get("correlation") or {}).get("iteration")
        if iteration is not None:
            capture["_file"] = name
            captures[iteration] = capture

    requests_with_summary = 0
    requests_without_summary = 0
    distinct_generations: dict[str, dict[str, Any]] = {}
    compaction_events: list[dict[str, Any]] = []
    retention = {
        "carries_task_contract": 0,
        "carries_completion_obligation": 0,
        "carries_canonical_evidence_record": 0,
    }
    previous_generation: str | None = None

    for iteration in sorted(captures):
        capture = captures[iteration]
        payload = capture.get("payload") or {}
        messages = payload.get("messages") or []
        first_text = ""
        if messages:
            content = messages[0].get("content")
            if isinstance(content, str):
                first_text = content
            elif isinstance(content, list):
                first_text = "".join(
                    str(b.get("text") or "") for b in content if isinstance(b, dict)
                )
        if not first_text.startswith("Context summary:"):
            requests_without_summary += 1
            previous_generation = None
            continue

        requests_with_summary += 1
        generation_id = "sha256:" + hashlib.sha256(
            first_text.encode("utf-8")
        ).hexdigest()[:16]
        is_new_generation = generation_id != previous_generation
        if generation_id not in distinct_generations:
            distinct_generations[generation_id] = {
                "generation_id": generation_id,
                "first_iteration": iteration,
                "summary_bytes": len(first_text.encode("utf-8")),
                "request_count": 0,
                "last_iteration": iteration,
            }
        record = distinct_generations[generation_id]
        record["request_count"] += 1
        record["last_iteration"] = iteration
        if is_new_generation:
            compaction_events.append(
                {
                    "iteration": iteration,
                    "generation_id": generation_id,
                    "summary_bytes": len(first_text.encode("utf-8")),
                    "message_count": len(messages),
                }
            )
        previous_generation = generation_id

        if CONTRACT_MARKER in first_text:
            retention["carries_task_contract"] += 1
        if REMINDER_MARKER in first_text:
            retention["carries_completion_obligation"] += 1
        if EVIDENCE_MARKER in first_text:
            retention["carries_canonical_evidence_record"] += 1

    total = len(captures)
    result = {
        "probe_id": "CORRECTION01_F1_COMPACTION_IDENTITY_V1",
        "run_id": args.run_id,
        "semantics": {
            "requests_with_compacted_summary": (
                "how many provider requests carried a compacted summary -- a "
                "STATE count, NOT a count of compaction events"
            ),
            "distinct_summary_generations": (
                "how many distinct summary payloads existed over the run"
            ),
            "compaction_events_observed": (
                "how many times the carried summary IDENTITY changed, i.e. how "
                "many new compaction generations began. A new compaction "
                "replaces the summary, so an identity change is the observable "
                "signature of a new compaction."
            ),
        },
        "provider_requests_total": total,
        "requests_with_compacted_summary": requests_with_summary,
        "requests_without_compacted_summary": requests_without_summary,
        "distinct_summary_generations": len(distinct_generations),
        "compaction_events_observed": len(compaction_events),
        "compaction_event_index": compaction_events,
        "summary_generations": [
            distinct_generations[g]
            for g in sorted(
                distinct_generations,
                key=lambda k: distinct_generations[k]["first_iteration"],
            )
        ],
        "retention_across_requests_carrying_a_summary": retention,
        "retention_denominator": requests_with_summary,
    }

    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(f"provider requests total                       : {total}")
    print(f"requests carrying a compacted summary (STATE) : {requests_with_summary}")
    print(f"requests without a compacted summary          : {requests_without_summary}")
    print(f"distinct summary generations                  : {len(distinct_generations)}")
    print(f"compaction EVENTS observed (identity change)  : {len(compaction_events)}")
    print(f"retention (task contract)                     : {retention['carries_task_contract']}/{requests_with_summary}")
    print(f"retention (completion obligation)             : {retention['carries_completion_obligation']}/{requests_with_summary}")
    print(f"retention (canonical evidence record)         : {retention['carries_canonical_evidence_record']}/{requests_with_summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

import os
import sys
from typing import Any

REMINDER_MARKER = (
    "not complete until you call one of these terminal completion tools"
)
CONTRACT_MARKER = "## Active task contract (authoritative)"
EVIDENCE_MARKER = "<!-- cline-evidence:begin -->"
