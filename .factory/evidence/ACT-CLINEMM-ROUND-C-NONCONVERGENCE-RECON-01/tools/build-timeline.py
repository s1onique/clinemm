#!/usr/bin/env python3
"""
ACT-CLINEMM-ROUND-C-NONCONVERGENCE-RECON-01
============================================
Timeline builder for the historical Qwen3.8 Q2_0 Round C session
`1795252560069_t82cp`.

READ-ONLY. Reads only from the operator's private ClineMM data directory and
writes ONLY sanitized artifacts into the ACT evidence directory.

SENSITIVE-DATA BOUNDARY
-----------------------
The raw session transcript may embed real credentials (the task prompt itself
warns about bootstrap-admin exposure). This builder therefore NEVER emits raw
tool-result text. It emits only:

  * structural identifiers (message ids, tool-call ids, tool names),
  * timestamps,
  * byte/character counts,
  * non-reversible content fingerprints (sha256 over normalized text),
  * classification labels.

Command lines are REDACTED to a stable sha256 fingerprint, so that "did the
agent repeat the same command?" is answerable without republishing the text.

Usage:
    python3 build-timeline.py \
        --session-dir  <...>/sessions/1795252560069_t82cp \
        --capture-dir  <...>/provider-request-captures \
        --out          <...>/timeline.jsonl
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import sys
from typing import Any

# CORRECTION02 P0-1: the compaction-generation identity and the summary
# transition classification are defined ONCE, in `compaction_probe.py`, and
# imported here so the timeline and the probe can never disagree.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compaction_probe import (  # noqa: E402
    classify_transition,
    strip_contract_section,
)

# --------------------------------------------------------------------------
# Phase boundaries (derived from the real trace; see timeline-summary.md).
# --------------------------------------------------------------------------
OPERATOR_INPUT_INDEX = 650  # first operator-authored <user_input mode="act">
FIRST_SUBMIT_INDEX = 652  # first submit_and_exit tool_use

PHASE_A = "A_autonomous_evidence_gathering"
PHASE_C = "C_operator_directed_synthesis"
PHASE_D = "D_post_intervention_completion"

REMINDER_MARKER = "not complete until you call one of these terminal completion tools"


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def short_fp(text: str) -> str:
    """Non-reversible short fingerprint of arbitrary text."""
    return "sha256:" + sha256_hex(text.encode("utf-8"))[:16]


def iso_utc(ms: int | None) -> str | None:
    if ms is None:
        return None
    return (
        _dt.datetime.fromtimestamp(ms / 1000, tz=_dt.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )


def tool_result_text(block: dict[str, Any]) -> str:
    """Extract the result text from the persisted tool_result envelope."""
    content = block.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict):
            parts.append(str(item.get("result") or ""))
    return "".join(parts)


def tool_result_command(block: dict[str, Any]) -> str:
    content = block.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict):
            parts.append(str(item.get("query") or ""))
    return " | ".join(p for p in parts if p)


def phase_for(index: int) -> str:
    if index < OPERATOR_INPUT_INDEX:
        return PHASE_A
    if index < FIRST_SUBMIT_INDEX:
        return PHASE_C
    return PHASE_D


def classify_message(message: dict[str, Any]) -> str:
    role = message.get("role")
    content = message.get("content")
    blocks = content if isinstance(content, list) else []
    types = [b.get("type") for b in blocks if isinstance(b, dict)]
    if role == "assistant":
        if "tool_use" in types:
            return "assistant_tool_call_turn"
        if "reasoning" in types or "thinking" in types:
            return "assistant_reasoning_only_turn"
        return "assistant_text_turn"
    if role == "user":
        if "tool_result" in types:
            return "tool_result_turn"
        text = ""
        for b in blocks:
            if isinstance(b, dict) and b.get("type") == "text":
                text = str(b.get("text") or "")
        if REMINDER_MARKER in text:
            return "runtime_completion_obligation_turn"
        if "Context summary:" in text:
            return "compaction_summary_turn"
        if text.lstrip().startswith("<user_input"):
            return "user_turn_start"
        return "runtime_control_turn"
    return "unknown_turn"

def build_events(
    session_messages: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    # CORRECTION01 F2: result-body fingerprints already seen, so that
    # NONEMPTY can be distinguished from CONTENT_DISTINCT.
    seen_result_fingerprints: set[str] = set()

    for index, message in enumerate(session_messages):
        phase = phase_for(index)
        kind = classify_message(message)
        content = message.get("content")
        blocks = content if isinstance(content, list) else []
        metrics = message.get("metrics") or {}
        model_info = message.get("modelInfo") or {}
        ts = message.get("ts")

        base: dict[str, Any] = {
            "seq": index,
            "phase": phase,
            "turn_kind": kind,
            "ts_ms": ts,
            "ts_utc": iso_utc(ts),
            "message_id": message.get("id"),
            "role": message.get("role"),
            "evidence_class": "DIRECT_TRACE",
        }

        if message.get("role") == "assistant":
            base["model"] = {
                "id": model_info.get("id"),
                "provider": model_info.get("provider"),
            }
            base["provider_metrics"] = {
                "input_tokens": metrics.get("inputTokens"),
                "output_tokens": metrics.get("outputTokens"),
                "cache_read_tokens": metrics.get("cacheReadTokens"),
                "cache_write_tokens": metrics.get("cacheWriteTokens"),
            }
            tool_uses = []
            for b in blocks:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    payload = json.dumps(b.get("input") or {}, sort_keys=True)
                    tool_uses.append(
                        {
                            "tool": b.get("name"),
                            "tool_call_id": b.get("id"),
                            "input_fingerprint": short_fp(payload),
                            "input_bytes": len(payload),
                        }
                    )
            base["tool_calls"] = tool_uses
            thinking = ""
            for b in blocks:
                if isinstance(b, dict) and b.get("type") in ("thinking", "reasoning"):
                    thinking += str(b.get("thinking") or b.get("text") or "")
            base["reasoning_bytes"] = len(thinking.encode("utf-8"))
            base["reasoning_fingerprint"] = short_fp(thinking) if thinking else None

        if kind == "tool_result_turn":
            for b in blocks:
                if not isinstance(b, dict) or b.get("type") != "tool_result":
                    continue
                text = tool_result_text(b)
                cmd = tool_result_command(b)
                result_fp = short_fp(text) if text else None
                # CORRECTION02 P0-2: the membership test MUST happen BEFORE
                # the insertion. The previous order inserted the fingerprint
                # first, so every nonempty result was already "seen" and the
                # classifier could never emit CONTENT_DISTINCT (measured:
                # 0 of 375 results were classified CONTENT_DISTINCT).
                is_content_distinct = (
                    result_fp is not None
                    and result_fp not in seen_result_fingerprints
                )
                if result_fp is not None:
                    seen_result_fingerprints.add(result_fp)
                events.append(
                    {
                        **base,
                        "event": "tool_result",
                        "tool": b.get("name"),
                        "tool_call_id": b.get("tool_use_id"),
                        "result_bytes": len(text.encode("utf-8")),
                        "result_fingerprint": short_fp(text) if text else None,
                        "command_fingerprint": short_fp(cmd) if cmd else None,
                        "is_error": bool(b.get("is_error")),
                        # CORRECTION01 F2: the previous value "none" /
                        # "content_present" conflated NONEMPTY with
                        # information gain. The corrected categories are:
                        #   EMPTY            -- no result body at all
                        #   NONEMPTY         -- a result body exists
                        #   CONTENT_DISTINCT -- the body differs from every
                        #                       other body seen so far
                        # FACTUALLY_NOVEL is NOT asserted here: whether a
                        # result contributed a new decision-relevant fact
                        # requires independent assessment and is left
                        # unproven at this layer.
                        "result_class": (
                            "EMPTY"
                            if not text.strip()
                            else (
                                "CONTENT_DISTINCT"
                                if is_content_distinct
                                else "NONEMPTY"
                            )
                        ),
                        "factually_novel": "UNPROVEN_AT_THIS_LAYER",
                    }
                )
            continue

        if kind in (
            "runtime_completion_obligation_turn",
            "user_turn_start",
            "compaction_summary_turn",
            "runtime_control_turn",
        ):
            text = ""
            for b in blocks:
                if isinstance(b, dict) and b.get("type") == "text":
                    text += str(b.get("text") or "")
            event_name = {
                "runtime_completion_obligation_turn": "completion_obligation_injected",
                "user_turn_start": "user_turn_start",
                "compaction_summary_turn": "compaction_summary_present",
                "runtime_control_turn": "runtime_control_injected",
            }[kind]
            events.append(
                {
                    **base,
                    "event": event_name,
                    "text_bytes": len(text.encode("utf-8")),
                    "text_fingerprint": short_fp(text) if text else None,
                    "carries_task_contract": "Active task contract (authoritative)" in text,
                    "carries_completion_obligation": REMINDER_MARKER in text,
                }
            )
            continue

        if message.get("role") == "assistant":
            events.append({**base, "event": "assistant_turn"})
            continue

    return events

def attach_provider_requests(
    events: list[dict[str, Any]],
    capture_index: dict[int, dict[str, Any]],
) -> None:
    """Join provider-request capture facts onto the assistant turns.

    The capture correlation carries `iteration` for the historical run
    (`run_3tw2rDtz`). Assistant turns in the transcript and provider
    iterations are 1:1 for the autonomous run (277 assistant turns and
    277 provider requests, both ordinal), so the join is exact and
    authoritatively observable -- not inferred.
    """
    assistant_events = [e for e in events if e.get("event") == "assistant_turn"]
    # CORRECTION01 F1: distinct compacted-summary generations seen so far.
    # A new generation id marks ONE compaction event.
    seen_generation_ids: set[str] = set()
    # The previously carried summary text, for transition classification.
    previous_summary_text: str | None = None
    for ordinal, event in enumerate(assistant_events, start=1):
        capture = capture_index.get(ordinal)
        if capture is None:
            event["provider_request"] = {
                "join": "UNAVAILABLE_FROM_TRACE",
                "reason": "no capture for this ordinal",
            }
            continue
        payload = capture.get("payload") or {}
        tools = payload.get("tools") or []
        names = [
            t if isinstance(t, str) else (t.get("function") or {}).get("name")
            for t in tools
        ]
        messages = payload.get("messages") or []
        first_text = ""
        if messages:
            c = messages[0].get("content")
            if isinstance(c, str):
                first_text = c
            elif isinstance(c, list):
                first_text = "".join(
                    str(b.get("text") or "") for b in c if isinstance(b, dict)
                )
        # CORRECTION01 F1: a compacted summary is a STATE that persists
        # across requests; it is not one compaction event per request.
        carries_summary = first_text.startswith("Context summary:")
        # CORRECTION01 (H2 claim integrity): the completion obligation is
        # measured over the WHOLE request, not only messages[0]. Before the
        # first compaction the obligation lives in messages[1]; after it, in
        # messages[0]. Measuring only messages[0] understates H2.
        whole_request_text = ""
        for m in messages:
            c = m.get("content")
            if isinstance(c, str):
                whole_request_text += c
            elif isinstance(c, list):
                whole_request_text += "".join(
                    str(b.get("text") or "") for b in c if isinstance(b, dict)
                )
        # CORRECTION01 F1: the previous key "is_compaction_summary" implied
        # one compaction EVENT per request. A summary PERSISTS across many
        # requests, so that inference was wrong. The corrected model is:
        #   carries_compacted_summary -- this request's messages[0] IS a
        #                                compacted summary (a state, not an event)
        #   compaction_generation_id    -- which distinct summary payload this
        #                                request carries; a NEW generation id
        #                                marks a new compaction event
        #   compaction_event            -- True only at the FIRST request that
        #                                carries a given generation id
        # CORRECTION02 P0-1: generation identity is computed on the
        # CONTRACT-STRIPPED summary, so the enriched projection of an
        # existing generation is the SAME generation, not a new compaction.
        core_text = strip_contract_section(first_text) if carries_summary else None
        generation_id = short_fp(core_text) if core_text else None
        transition = (
            classify_transition(previous_summary_text, first_text)
            if carries_summary
            else "NO_SUMMARY"
        )
        if carries_summary:
            previous_summary_text = first_text
        event["provider_request"] = {
            "join": "DIRECT_TRACE",
            "capture_file": capture.get("_file"),
            "capture_timestamp": capture.get("timestamp"),
            "run_id": (capture.get("correlation") or {}).get("runId"),
            "iteration": (capture.get("correlation") or {}).get("iteration"),
            "request_sha256": (capture.get("summary") or {}).get("sha256"),
            "estimated_tokens": (capture.get("summary") or {}).get("estimatedTokens"),
            "payload_bytes": (capture.get("summary") or {}).get("payloadBytes"),
            "max_output_tokens": payload.get("maxOutputTokens"),
            "tool_schema_names": names,
            "submit_and_exit_in_tool_schema": "submit_and_exit" in names,
            "completion_obligation_in_messages": REMINDER_MARKER in first_text,
            "completion_obligation_anywhere_in_request": (
                REMINDER_MARKER in whole_request_text
            ),
            "task_contract_in_messages": "Active task contract (authoritative)"
            in first_text,
            "carries_compacted_summary": carries_summary,
            "compaction_generation_id": generation_id,
            "compaction_event": transition in ("FIRST_SUMMARY", "NEW_COMPACTION"),
            "generation_transformation": transition == "SAME_GENERATION_ENRICHED",
            "summary_transition": transition,
            "distinct_compaction_generations_observed": len(seen_generation_ids),
        }
        if generation_id is not None and generation_id not in seen_generation_ids:
            seen_generation_ids.add(generation_id)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-dir", required=True)
    parser.add_argument("--capture-dir", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--run-id", default="run_3tw2rDtz")
    parser.add_argument("--session-id", default="1795252560069_t82cp")
    args = parser.parse_args()

    messages_path = os.path.join(args.session_dir, f"{args.session_id}.messages.json")
    with open(messages_path, "r", encoding="utf-8") as handle:
        session_doc = json.load(handle)
    session_messages = session_doc.get("messages") or []

    capture_index: dict[int, dict[str, Any]] = {}
    prefix = f"cap_{args.run_id}_"
    for name in sorted(os.listdir(args.capture_dir)):
        if not name.startswith(prefix):
            continue
        if not name.endswith(".provider-request.json"):
            continue
        path = os.path.join(args.capture_dir, name)
        with open(path, "r", encoding="utf-8") as handle:
            capture = json.load(handle)
        iteration = (capture.get("correlation") or {}).get("iteration")
        if iteration is None:
            continue
        capture["_file"] = name
        capture_index[iteration] = capture

    events = build_events(session_messages)
    attach_provider_requests(events, capture_index)

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, sort_keys=True) + "\n")

    print(f"wrote {len(events)} events to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
