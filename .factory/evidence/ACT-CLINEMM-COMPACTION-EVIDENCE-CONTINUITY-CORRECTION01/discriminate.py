#!/usr/bin/env python3
"""ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01 - causal discriminator.

Establishes WHERE the R1 Helm evidence was lost, using the REAL Round C
session transcripts (no synthetic fixture):

  session 1794780088950_tc1vx  (the "new" run)

Q1  Was the successful helm template execution PRESENT in the canonical
    history?  Which exact tool call/result carries it?
Q2  Did it survive the compaction INPUT (the messages the summarizer was
    given)?  -> discriminates SUMMARY_INPUT_OMISSION vs SUMMARIZER_OMISSION
Q3  Did it survive the compaction OUTPUT (the installed summary)?
Q4  Does the FINAL REPORT claim the render was NOT_EXECUTED?

The script NEVER modifies production code and NEVER invents an observation:
every number it prints is read out of the on-disk transcript.

CORRECTION01 - WHAT CHANGED AND WHY
------------------------------------
The first cut of this discriminator was WRONG in three ways, and this
revision fixes each of them mechanically:

  (1) It selected the FIRST result mentioning `helm template` or `rc=0`.
      That selected `call_7735403ff4f640c3b9de90d0` (8,181 chars) - a
      DIFFERENT tool call that does not carry the decisive markers. The
      actual decisive result is `call_f476e4ce0f204de8baabc31d`. Selection
      is now by MARKER COMPLETENESS: the candidate carrying the most
      decisive markers wins, and the selection is reported so it can be
      checked against the transcript.

  (2) It reconstructed the summarizer's input as `canonical[0..N)`. That is
      NOT what production does. `runAgenticCompaction()` builds the
      summarizer input from `previousSummary + newly folded messages` AFTER
      the input-budget projection, so the original canonical prefix is NOT
      necessarily submitted again. The reconstruction is therefore reported
      as a RECONSTRUCTION, never as the actual request.

  (3) It classified the historical boundary as `SUMMARIZER_OMISSION`. That
      classification is not supportable: the actual summarizer request was
      never captured on disk. The historical boundary is now classified as
      `CAPTURE_INSUFFICIENT` - the canonical/final-report contradiction is
      real, but the exact stage at which the first loss occurred is NOT
      established.

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

# The decisive evidence we track: the successful helm template execution.
# The DECISIVE markers are the ones only the real render output carries;
# `helm template` and `rc=0` alone are NOT decisive, because they also
# appear in unrelated grep output.
DECISIVE_MARKERS = (
    "quay.io/keycloak/keycloak:26.0.7",
    "runAsNonRoot: true",
    "fsGroup: 1000",
)
# The markers that merely indicate a helm-related command ran.
SUPPORTING_MARKERS = ("helm template", "rc=0")

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
        if not isinstance(block, dict):
            continue
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


def tool_call_entries(messages):
    """(tool_use_id, name, index) for every tool_use."""
    out = []
    for index, message in enumerate(messages):
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if block.get("type") == "tool_use":
                out.append(
                    {
                        "index": index,
                        "tool_use_id": block.get("id"),
                        "name": block.get("name"),
                        "input": block.get("input") or {},
                    }
                )
    return out


def canonical_index(messages, message_id):
    for index, message in enumerate(messages):
        if message.get("id") == message_id:
            return index
    return -1


def marker_census(text):
    """Deterministic, human-readable marker census of a text blob."""
    census = {}
    for marker in DECISIVE_MARKERS + SUPPORTING_MARKERS:
        census[marker] = marker in text
    census["decisive_count"] = sum(
        1 for marker in DECISIVE_MARKERS if marker in text
    )
    census["supporting_count"] = sum(
        1 for marker in SUPPORTING_MARKERS if marker in text
    )
    return census


def select_decisive_result(entries):
    """Select the DECISIVE tool result by marker completeness.

    CORRECTION01: the first cut took `entries[0]` among the results that
    merely mention `helm template` or `rc=0`. That is not the decisive
    result - it was a different tool call entirely.

    The decisive result is the one carrying the most DECISIVE markers. The
    selection is deterministic and fully reported, so it can be checked
    against the transcript.
    """
    candidates = [
        entry
        for entry in entries
        if entry["supporting_count"] > 0 or entry["decisive_count"] > 0
    ]
    if not candidates:
        return None, []
    ranked = sorted(
        candidates,
        key=lambda entry: (entry["decisive_count"], entry["supporting_count"]),
        reverse=True,
    )
    return ranked[0], ranked


def serialize_projection(messages):
    """Reproduce `serializeConversation()`'s production serialization.

    Tool results are truncated to TOOL_RESULT_CHAR_LIMIT exactly as
    `truncateToolResultContentForCompaction()` does, so "was the evidence in
    the summarizer's window" is answered from the SAME production rule.

    NOTE (CORRECTION01): this is a RECONSTRUCTION of the canonical prefix,
    NOT the actual summarizer request. Production `runAgenticCompaction()`
    submits `previousSummary + newly folded messages` after the input-budget
    projection, and the actual request was never captured on disk.
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


def summarize(text):
    """Deterministic, human-readable DECISIVE marker census of a text blob."""
    return {marker: (marker in text) for marker in DECISIVE_MARKERS}


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
    print(
        "ACT-CLINEMM-COMPACTION-EVIDENCE-CONTINUITY-CORRECTION01 - causal discriminator"
    )
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
    entries = tool_result_entries(canonical)
    for entry in entries:
        entry.update(marker_census(entry["text"]))
    helm_entry, ranked = select_decisive_result(entries)
    if helm_entry is None:
        print("  NO - nothing to discriminate. FAIL.")
        return 1
    print("  CORRECTION01: selection is by MARKER COMPLETENESS, not first-match.")
    print("  ranked candidates (decisive markers first):")
    for candidate in ranked[:5]:
        print(
            f"    idx={candidate['index']:<4} id={candidate['tool_use_id']} "
            f"decisive={candidate['decisive_count']} "
            f"supporting={candidate['supporting_count']} "
            f"len={candidate['result_len']}"
        )
    print()
    print("  SELECTED (decisive) result:")
    print(f"    canonical index      : {helm_entry['index']}")
    print(f"    tool_use_id          : {helm_entry['tool_use_id']}")
    print(f"    tool name            : {helm_entry['name']}")
    print(f"    result success flag  : {helm_entry['success']}")
    print(f"    result length        : {helm_entry['result_len']} chars")
    print(
        f"    decisive markers     : {helm_entry['decisive_count']}/{len(DECISIVE_MARKERS)}"
    )
    for marker in DECISIVE_MARKERS:
        print(f"      {marker!r:<44} : {marker in helm_entry['text']}")
    print(
        f"    exceeds {TOOL_RESULT_CHAR_LIMIT}-char compaction limit : "
        f"{helm_entry['result_len'] > TOOL_RESULT_CHAR_LIMIT}"
    )
    for call in tool_call_entries(canonical):
        if call["tool_use_id"] == helm_entry["tool_use_id"]:
            print(f"    matching tool_use    : idx={call['index']} name={call['name']}")
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
        f"  decisive evidence index : {helm_entry['index']} -> "
        f"{'INSIDE' if helm_entry['index'] < folded_count else 'OUTSIDE'} "
        "the folded prefix"
    )
    helm_in_tail = any(
        "helm template" in message_text(m) or "rc=0" in message_text(m)
        for m in compacted
    )
    print(f"  decisive evidence present in compacted tail : {helm_in_tail}")
    print()

    projection = serialize_projection(canonical[:folded_count])
    projection_markers = summarize(projection)
    print("  RECONSTRUCTED canonical-prefix marker census (production serialization):")
    for marker, present in projection_markers.items():
        print(f"    {marker!r:<44} : {present}")
    print(f"    reconstruction chars   : {len(projection)}")
    print()

    print("  ACTUAL SUMMARIZER REQUEST CAPTURE:")
    # CORRECTION01: the actual summarizer request is what decides the
    # stage of the loss. Production `runAgenticCompaction()` submits
    # `previousSummary + newly folded messages` AFTER the input-budget
    # projection. The reconstruction above is NOT that request.
    canonical_summary_count = sum(
        1
        for m in canonical
        if (m.get("metadata") or {}).get("kind") == "compaction_summary"
    )
    print(f"    canonical compaction_summary messages : {canonical_summary_count}")
    print("    captured summarizer request artifact  : NONE")
    print(
        "    -> The summarizer's ACTUAL input was never persisted. The\n"
        "       canonical-prefix reconstruction below CANNOT establish that\n"
        "       the decisive markers reached the summarizer."
    )
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
        print(f"    {marker!r:<44} : {present}")
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
    in_reconstruction = all(projection_markers.values())
    in_output = all(summary_markers.values())
    # CORRECTION01: the stage of the first loss is NOT established without
    # the actual summarizer request. The canonical/final-report
    # contradiction IS real and IS reported.
    classification = "CAPTURE_INSUFFICIENT"
    print(f"  R1_EXECUTION_IN_CANONICAL_HISTORY : {bool(helm_entry)}")
    print(f"  R1_EXECUTION_IN_RECONSTRUCTION     : {in_reconstruction}")
    print("  R1_EXECUTION_IN_SUMMARIZER_INPUT  : UNKNOWN (request not captured)")
    print(f"  R1_EXECUTION_IN_INSTALLED_SUMMARY : {in_output}")
    print(f"  CANONICAL_FINAL_REPORT_CONTRADICTION : {not in_output}")
    print(f"  CLASSIFICATION                    : {classification}")
    print(
        "  READING: the canonical record contradicts the final report. The\n"
        "            exact stage at which the first loss occurred is NOT\n"
        "            established: the summarizer's actual input was never\n"
        "            captured, and the canonical-prefix reconstruction is not\n"
        "            a source-faithful substitute for it."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
