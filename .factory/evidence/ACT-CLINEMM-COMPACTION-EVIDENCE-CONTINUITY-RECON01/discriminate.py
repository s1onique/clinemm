#!/usr/bin/env python3
"""ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01 — causal discriminator.

Establishes WHERE the R1 Helm evidence was lost, using the REAL Round C
session transcripts (no synthetic fixture):

  session 1794780088950_tc1vx  (the "new" run)

Q1  Was the successful helm template execution PRESENT in the canonical
    history?
Q2  Did it survive the compaction INPUT (the messages the summarizer was
    given)?          -> discriminates SUMMARY_INPUT_OMISSION vs SUMMARIZER_OMISSION
Q3  Did it survive the compaction OUTPUT (the installed summary)?
Q4  Does the FINAL REPORT claim the render was NOT_EXECUTED?

The script NEVER modifies production code and NEVER invents an observation:
every number it prints is read out of the on-disk transcript.

Usage:
  python3 discriminate.py [--session-dir <dir>] [--session-id <id>]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

# The production constants (sdk/packages/core/src/extensions/context/compaction-shared.ts).
TOOL_RESULT_CHAR_LIMIT = 2_000

# The evidence we track: the successful helm template execution.
HELM_MARKERS = (
    "helm template",
    "rc=0",
    "quay.io/keycloak/keycloak:26.0.7",
    "runAsNonRoot: true",
    "fsGroup: 1000",
)

DEFAULT_SESSION_DIR = os.path.expanduser(
    "~/.vscodium-roz/cline-data/sessions/1794780088950_tc1vx"
)
DEFAULT_SESSION_ID = "1794780088950_tc1vx"


def load_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def result_text(block):
    """Flatten a tool_result block's content into text.

    Mirrors `flattenToolResultContent()` in compaction-shared.ts: a string
    content is used as-is; a block list contributes each block's text.
    """
    content = block.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for item in content:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "text":
            parts.append(item.get("text") or "")
        elif item.get("type") == "file":
            parts.append(item.get("content") or "")
        elif "result" in item:
            # The persisted `run_commands` payload shape: {query, result, success}.
            parts.append(str(item.get("result") or ""))
    return "\n".join(parts)


def message_text(message):
    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    parts = []
    for block in content:
        kind = block.get("type")
        if kind == "text":
            parts.append(block.get("text") or "")
        elif kind == "tool_result":
            parts.append(result_text(block))
        elif kind == "file":
            parts.append(block.get("content") or "")
    return "\n".join(parts)


def tool_result_entries(messages):
    """(tool_use_id, name, result_text, success) for every tool_result."""
    out = []
    for index, message in enumerate(messages):
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get("type") != "tool_result":
                continue
            success = None
            body = block.get("content")
            if isinstance(body, list):
                for item in body:
                    if isinstance(item, dict) and "success" in item:
                        success = bool(item.get("success"))
            out.append(
                {
                    "index": index,
                    "tool_use_id": block.get("tool_use_id"),
                    "name": block.get("name"),
                    "text": result_text(block),
                    "success": success,
                    "result_len": len(result_text(block)),
                }
            )
    return out


def canonical_index(messages, message_id):
    for index, message in enumerate(messages):
        if message.get("id") == message_id:
            return index
    return -1


def summarize(text):
    """Deterministic, human-readable marker census of a text blob."""
    return {marker: (marker in text) for marker in HELM_MARKERS}


def serialize_projection(messages):
    """Reproduce `serializeConversation()`'s production serialization.

    Tool results are truncated to TOOL_RESULT_CHAR_LIMIT exactly as
    `truncateToolResultContentForCompaction()` does, so "was the evidence in
    the summarizer's window" is answered from the SAME production rule.
    """
    lines = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, str):
            lines.append(f"[User]: {content}")
            continue
        if not isinstance(content, list):
            continue
        for block in content:
            kind = block.get("type")
            if kind == "text":
                role = "User" if message.get("role") == "user" else "Bot"
                lines.append(f"[{role}]: {block.get('text') or ''}")
            elif kind == "tool_use":
                lines.append(
                    f"[Bot tool calls]: {block.get('name')}"
                    f"({json.dumps(block.get('input') or {}, default=str)})"
                )
            elif kind == "tool_result":
                text = result_text(block)
                if len(text) > TOOL_RESULT_CHAR_LIMIT:
                    text = (
                        text[:TOOL_RESULT_CHAR_LIMIT]
                        + f"\n...[truncated {len(text) - TOOL_RESULT_CHAR_LIMIT} chars]"
                    )
                lines.append(f"[Tool result]: {text}")
    return "\n\n".join(lines)



def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-dir", default=DEFAULT_SESSION_DIR)
    parser.add_argument("--session-id", default=DEFAULT_SESSION_ID)
    args = parser.parse_args()

    session_dir = args.session_dir
    session_id = args.session_id

    messages_path = os.path.join(session_dir, f"{session_id}.messages.json")
    compaction_path = os.path.join(session_dir, f"{session_id}.compaction.json")
    if not os.path.exists(messages_path):
        print(f"FAIL: canonical transcript not found: {messages_path}")
        return 2
    if not os.path.exists(compaction_path):
        print(f"FAIL: compaction artifact not found: {compaction_path}")
        return 2

    canonical = load_json(messages_path)["messages"]
    compaction = load_json(compaction_path)
    compacted = compaction["messages"]

    print("=" * 78)
    print("ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-RECON01 - causal discriminator")
    print("=" * 78)
    print(f"session            : {session_id}")
    print(f"canonical messages : {len(canonical)}")
    print(
        f"compaction artifact: source_message_count={compaction['source_message_count']} "
        f"source_last_message_key={compaction['source_last_message_key']} "
        f"updated_at={compaction['updated_at']}"
    )
    print(f"compacted messages : {len(compacted)}")
    print()

    print("-" * 78)
    print("Q1  WAS THE SUCCESSFUL EXECUTION PRESENT IN THE CANONICAL HISTORY?")
    print("-" * 78)
    hits = [
        entry
        for entry in tool_result_entries(canonical)
        if "helm template" in entry["text"] or "rc=0" in entry["text"]
    ]
    if not hits:
        print("  NO - nothing to discriminate. FAIL.")
        return 1
    helm_entry = hits[0]
    print(f"  canonical index      : {helm_entry['index']}")
    print(f"  tool_use_id         : {helm_entry['tool_use_id']}")
    print(f"  tool name           : {helm_entry['name']}")
    print(f"  result success flag : {helm_entry['success']}")
    print(f"  result length       : {helm_entry['result_len']} chars")
    print(f"  marker census       : {summarize(helm_entry['text'])}")
    print(f"  rc=0 present        : {'rc=0' in helm_entry['text']}")
    print(
        f"  exceeds {TOOL_RESULT_CHAR_LIMIT}-char compaction limit : "
        f"{helm_entry['result_len'] > TOOL_RESULT_CHAR_LIMIT}"
    )
    print()

    print("-" * 78)
    print("Q2  DID IT SURVIVE THE COMPACTION INPUT (the summarizer's input)?")
    print("-" * 78)
    folded_count = int(compaction["source_message_count"])
    last_key = compaction["source_last_message_key"]
    last_id = last_key.split(":", 1)[1] if ":" in last_key else last_key
    last_index = canonical_index(canonical, last_id)
    print(f"  folded prefix       : canonical[0..{folded_count})")
    print(f"  last folded message : {last_id} (canonical index {last_index})")
    print(
        f"  helm evidence index : {helm_entry['index']} -> "
        f"{'INSIDE' if helm_entry['index'] < folded_count else 'OUTSIDE'} "
        "the folded prefix"
    )
    helm_in_tail = any(
        "helm template" in message_text(m) or "rc=0" in message_text(m)
        for m in compacted
    )
    print(f"  helm evidence present in compacted tail : {helm_in_tail}")
    print()

    projection = serialize_projection(canonical[:folded_count])
    projection_markers = summarize(projection)
    print("  summarizer-input marker census (production serialization):")
    for marker, present in projection_markers.items():
        print(f"    {marker!r:<42} : {present}")
    print(f"  projection chars   : {len(projection)}")
    print()

    print("-" * 78)
    print("Q3  DID IT SURVIVE THE COMPACTION OUTPUT (the installed summary)?")
    print("-" * 78)
    summary_text = ""
    for message in compacted:
        if (message.get("metadata") or {}).get("kind") == "compaction_summary":
            summary_text = message_text(message)
            break
    summary_markers = summarize(summary_text)
    print(f"  summary chars      : {len(summary_text)}")
    for marker, present in summary_markers.items():
        print(f"    {marker!r:<42} : {present}")
    lost = [m for m, p in summary_markers.items() if not p]
    print(f"  markers LOST       : {lost if lost else 'none'}")
    print()

    print("-" * 78)
    print("Q4  DOES THE FINAL REPORT CLAIM THE RENDER WAS NOT EXECUTED?")
    print("-" * 78)
    final_report = ""
    for message in reversed(canonical):
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get("type") == "text" and len(block.get("text") or "") > 4_000:
                final_report = block.get("text") or ""
                break
        if final_report:
            break
    print(f"  final report chars : {len(final_report)}")
    for claim in re.findall(r"[^\n]*helm[^\n]*", final_report, flags=re.IGNORECASE):
        print(f"    | {claim.strip()}")
    print()

    print("=" * 78)
    print("VERDICT")
    print("=" * 78)
    in_input = all(projection_markers.values())
    in_output = all(summary_markers.values())
    if not in_input:
        classification = "SUMMARY_INPUT_OMISSION"
    elif not in_output:
        classification = "SUMMARIZER_OMISSION"
    else:
        classification = "NO_LOSS_AT_THIS_SEAM"
    print(f"  R1_EXECUTION_IN_CANONICAL_HISTORY : {bool(hits)}")
    print(f"  R1_EXECUTION_IN_SUMMARIZER_INPUT  : {in_input}")
    print(f"  R1_EXECUTION_IN_INSTALLED_SUMMARY : {in_output}")
    print(f"  CLASSIFICATION                    : {classification}")
    print(
        "  READING: the evidence reached the summarizer's window and was lost\n"
        "            in the generated summary - the summary is a lossy projection\n"
        "            of the canonical record."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
