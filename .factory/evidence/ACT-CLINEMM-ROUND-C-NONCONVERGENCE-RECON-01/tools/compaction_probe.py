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
    python3 compaction_probe.py --capture-dir <private> \
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
CONTRACT_BEGIN = "<!-- cline-task-contract:begin -->"
CONTRACT_END = "<!-- cline-task-contract:end -->"


def strip_contract_section(text: str) -> str:
    """Reduce a summary to its underlying COMPACTION GENERATION.

    CORRECTION02 P0-1: an enriched projection of a compaction generation
    differs from the generation ONLY by a DUPLICATED contract heading
    ("## Active task contract (authoritative)") inserted immediately before
    the existing "<!-- cline-task-contract:begin -->" marker. Removing the
    duplicate heading restores the generation text, so the generation
    identity must be computed on this reduced form.

    Measured on the historical run: all 8 adjacent generation pairs differ
    by exactly 2 added lines (one blank, one duplicate heading) and 0
    removed lines.
    """
    lines = text.split("\n")
    # Identify every contract heading and whether it is immediately followed
    # (skipping blank lines) by the contract BEGIN marker. A heading that is
    # NOT immediately followed by BEGIN is the DUPLICATE inserted by the
    # enrichment and is removed.
    heading_indices = [
        index
        for index, line in enumerate(lines)
        if line.strip() == CONTRACT_MARKER
    ]
    # The enriched projection carries the heading TWICE: once immediately
    # before the contract BEGIN marker (the original) and once as an
    # inserted copy whose next non-empty line is the OTHER heading. The
    # INSERTED copy is the one that is NOT followed by BEGIN, so it is the
    # one to remove. Removing it (plus the blank line that precedes it)
    # restores the generation text exactly.
    duplicate_indices: set[int] = set()
    for index in heading_indices:
        probe = index + 1
        while probe < len(lines) and not lines[probe].strip():
            probe += 1
        followed_by_begin = (
            probe < len(lines) and lines[probe].strip() == CONTRACT_BEGIN
        )
        if not followed_by_begin:
            duplicate_indices.add(index)
            # Also drop the blank line that separates the two headings.
            blank = index - 1
            while blank >= 0 and not lines[blank].strip():
                duplicate_indices.add(blank)
                blank -= 1
            break
    if not duplicate_indices:
        return text
    out = [
        line
        for index, line in enumerate(lines)
        if index not in duplicate_indices
    ]
    return "\n".join(out)


def classify_transition(previous: str | None, current: str) -> str:
    """Classify the transition between the previously carried summary and the
    currently carried summary.

    CORRECTION02 P0-1: the previous implementation counted every summary
    IDENTITY change as a new compaction, which double-counted the enriched
    projection of an existing generation. The classification is now:

      FIRST_SUMMARY          -- the first summary carried in the run
      NEW_COMPACTION         -- the underlying generation (contract-stripped)
                               is different: a genuinely new summary was
                               produced by a compaction.
      SAME_GENERATION_ENRICHED
                            -- the contract-stripped generation is IDENTICAL
                               and the only change is the appended
                               task-contract section: a TRANSFORMATION of the
                               existing generation, not a new compaction.
      SAME_GENERATION        -- the contract-stripped generation is identical
                               and no contract section was added.
    """
    if previous is None:
        return "FIRST_SUMMARY"
    previous_core = strip_contract_section(previous)
    current_core = strip_contract_section(current)
    if previous_core != current_core:
        return "NEW_COMPACTION"
    if previous != current:
        # Same generation, different provider-visible payload: the only
        # observed difference is the duplicated contract heading.
        return "SAME_GENERATION_ENRICHED"
    return "SAME_GENERATION"


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
    # CORRECTION02 P0-1: the generation identity is computed on the
    # CONTRACT-STRIPPED summary, so an enriched projection of an existing
    # generation is NOT counted as a new compaction.
    distinct_generations: dict[str, dict[str, Any]] = {}
    distinct_payloads: dict[str, dict[str, Any]] = {}
    compaction_events: list[dict[str, Any]] = []
    transformations: list[dict[str, Any]] = []
    transition_index: list[dict[str, Any]] = []
    retention = {
        "carries_task_contract": 0,
        "carries_completion_obligation": 0,
        "carries_canonical_evidence_record": 0,
    }
    previous_text: str | None = None

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

        # Distinct PROVIDER-VISIBLE payload (the enriched projection counts).
        payload_id = "sha256:" + hashlib.sha256(
            first_text.encode("utf-8")
        ).hexdigest()[:16]
        if payload_id not in distinct_payloads:
            distinct_payloads[payload_id] = {
                "payload_id": payload_id,
                "first_iteration": iteration,
                "payload_bytes": len(first_text.encode("utf-8")),
                "request_count": 0,
            }
        distinct_payloads[payload_id]["request_count"] += 1

        # Distinct COMPACTION GENERATION (contract-stripped identity).
        core_text = strip_contract_section(first_text)
        generation_id = "sha256:" + hashlib.sha256(
            core_text.encode("utf-8")
        ).hexdigest()[:16]
        transition = classify_transition(previous_text, first_text)
        transition_index.append(
            {
                "iteration": iteration,
                "transition": transition,
                "generation_id": generation_id,
                "payload_id": payload_id,
                "payload_bytes": len(first_text.encode("utf-8")),
                "message_count": len(messages),
            }
        )
        if generation_id not in distinct_generations:
            distinct_generations[generation_id] = {
                "generation_id": generation_id,
                "first_iteration": iteration,
                "generation_bytes": len(core_text.encode("utf-8")),
                "request_count": 0,
                "last_iteration": iteration,
            }
        record = distinct_generations[generation_id]
        record["request_count"] += 1
        record["last_iteration"] = iteration

        if transition in ("FIRST_SUMMARY", "NEW_COMPACTION"):
            compaction_events.append(
                {
                    "iteration": iteration,
                    "transition": transition,
                    "generation_id": generation_id,
                    "payload_id": payload_id,
                    "payload_bytes": len(first_text.encode("utf-8")),
                    "message_count": len(messages),
                }
            )
        elif transition == "SAME_GENERATION_ENRICHED":
            transformations.append(
                {
                    "iteration": iteration,
                    "transition": transition,
                    "generation_id": generation_id,
                    "payload_id": payload_id,
                    "payload_bytes": len(first_text.encode("utf-8")),
                    "message_count": len(messages),
                    "note": (
                        "the task-contract section was appended to an existing "
                        "compaction generation; NOT a new compaction"
                    ),
                }
            )
        previous_text = first_text

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
            "distinct_provider_visible_summary_payloads": (
                "how many distinct provider-visible summary payloads existed. "
                "This counts the enriched projections as separate payloads."
            ),
            "distinct_compaction_generations": (
                "how many distinct compaction GENERATIONS existed. The "
                "generation identity is computed on the CONTRACT-STRIPPED "
                "summary, so an enriched projection of an existing generation "
                "is the SAME generation, not a new one."
            ),
            "compaction_events_observed": (
                "how many NEW compaction generations began, i.e. transitions "
                "where the contract-stripped summary changed. This is the "
                "authoritative observable for a new compaction."
            ),
            "generation_transformations_observed": (
                "how many times an existing generation was merely TRANSFORMED "
                "(the task-contract section was appended). These are NOT "
                "compaction events."
            ),
        },
        "provider_requests_total": total,
        "requests_with_compacted_summary": requests_with_summary,
        "requests_without_compacted_summary": requests_without_summary,
        "distinct_provider_visible_summary_payloads": len(distinct_payloads),
        "distinct_compaction_generations": len(distinct_generations),
        "compaction_events_observed": len(compaction_events),
        "generation_transformations_observed": len(transformations),
        "compaction_event_index": compaction_events,
        "generation_transformation_index": transformations,
        "transition_index": transition_index,
        "summary_generations": [
            distinct_generations[g]
            for g in sorted(
                distinct_generations,
                key=lambda k: distinct_generations[k]["first_iteration"],
            )
        ],
        "summary_payloads": [
            distinct_payloads[p]
            for p in sorted(
                distinct_payloads,
                key=lambda k: distinct_payloads[k]["first_iteration"],
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
    print(f"distinct PROVIDER-VISIBLE summary payloads    : {len(distinct_payloads)}")
    print(f"distinct COMPACTION GENERATIONS               : {len(distinct_generations)}")
    print(f"compaction EVENTS observed                     : {len(compaction_events)}")
    print(f"generation TRANSFORMATIONS observed           : {len(transformations)}")
    print(f"retention (task contract)                     : {retention['carries_task_contract']}/{requests_with_summary}")
    print(f"retention (completion obligation)             : {retention['carries_completion_obligation']}/{requests_with_summary}")
    print(f"retention (canonical evidence record)         : {retention['carries_canonical_evidence_record']}/{requests_with_summary}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
